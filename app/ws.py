"""WebSocket connection manager for broadcasting game state."""

import asyncio
import json
import time
from typing import Dict, List, Optional, Set, Tuple

from fastapi import WebSocket


HEARTBEAT_TIMEOUT = 20  # seconds without heartbeat before disconnecting
CLEANUP_INTERVAL = 10  # seconds between stale-connection checks
INACTIVE_LEAVE_TIMEOUT = 60  # seconds inactive before forcing player to leave table


class ConnectionManager:
    """Tracks WebSocket connections per table and broadcasts state updates."""

    def __init__(self) -> None:
        # table_name -> set of (websocket, player_id)
        self._connections: Dict[str, Set[Tuple[WebSocket, Optional[str]]]] = {}
        # (table_name, id(websocket)) -> last heartbeat timestamp
        self._last_heartbeat: Dict[Tuple[str, int], float] = {}
        # (table_name, player_id) -> when player disconnected (became inactive)
        self._inactive_since: Dict[Tuple[str, str], float] = {}
        self._lock = asyncio.Lock()

    async def is_player_connected(self, table_name: str, player_id: str) -> bool:
        """True if this player has an active WebSocket for this table."""
        async with self._lock:
            conns = self._connections.get(table_name, set())
            return any(pid == player_id for _, pid in conns if pid)

    def _get_active_player_ids(self, table_name: str) -> List[str]:
        """Return list of player_ids with active connections (caller must hold _lock)."""
        conns = self._connections.get(table_name, set())
        return list({pid for _, pid in conns if pid})

    async def get_active_player_ids(self, table_name: str) -> List[str]:
        """Return list of player_ids with active connections."""
        async with self._lock:
            return self._get_active_player_ids(table_name)

    async def connect(
        self, websocket: WebSocket, table_name: str, player_id: Optional[str] = None
    ) -> None:
        """Register connection. Caller must accept websocket first."""
        async with self._lock:
            if player_id:
                self._inactive_since.pop((table_name, player_id), None)
            if table_name not in self._connections:
                self._connections[table_name] = set()
            self._connections[table_name].add((websocket, player_id))
            self._last_heartbeat[(table_name, id(websocket))] = time.monotonic()

    async def record_heartbeat(self, websocket: WebSocket, table_name: str) -> None:
        """Update last heartbeat timestamp for this connection."""
        async with self._lock:
            key = (table_name, id(websocket))
            if key in self._last_heartbeat:
                self._last_heartbeat[key] = time.monotonic()

    async def disconnect(self, websocket: WebSocket, table_name: str) -> None:
        async with self._lock:
            self._last_heartbeat.pop((table_name, id(websocket)), None)
            if table_name in self._connections:
                to_remove = [(ws, pid) for ws, pid in self._connections[table_name] if ws == websocket]
                for ws, pid in to_remove:
                    self._connections[table_name].discard((ws, pid))
                    if pid:
                        self._inactive_since[(table_name, pid)] = time.monotonic()
                if not self._connections[table_name]:
                    del self._connections[table_name]

    async def cleanup_stale_connections(self, broadcast_fn) -> None:
        """Disconnect connections with no heartbeat in HEARTBEAT_TIMEOUT. Broadcast updated state."""
        now = time.monotonic()
        stale_list = []  # [(table_name, websocket), ...]
        affected_tables = set()
        async with self._lock:
            for (tn, ws_id), last in list(self._last_heartbeat.items()):
                if now - last > HEARTBEAT_TIMEOUT:
                    conns = self._connections.get(tn, set())
                    for ws, _ in conns:
                        if id(ws) == ws_id:
                            stale_list.append((tn, ws))
                            affected_tables.add(tn)
                            break
            for tn, ws in stale_list:
                self._last_heartbeat.pop((tn, id(ws)), None)
                conns = self._connections.get(tn, set())
                to_remove = [(w, pid) for w, pid in conns if w == ws]
                for w, pid in to_remove:
                    conns.discard((w, pid))
                    if pid:
                        self._inactive_since[(tn, pid)] = time.monotonic()
                if not conns:
                    self._connections.pop(tn, None)
        for tn, ws in stale_list:
            try:
                await ws.close()
            except Exception:
                pass
        for tn in affected_tables:
            await broadcast_fn(tn)

    async def get_players_inactive_over_60s(self) -> List[Tuple[str, str]]:
        """Return (table_name, player_id) of players inactive for over INACTIVE_LEAVE_TIMEOUT seconds."""
        now = time.monotonic()
        result = []
        async with self._lock:
            active = {
                (tn, pid)
                for tn in self._connections
                for _, pid in self._connections[tn]
                if pid
            }
            for (tn, pid), since in list(self._inactive_since.items()):
                if (tn, pid) not in active and (now - since) > INACTIVE_LEAVE_TIMEOUT:
                    result.append((tn, pid))
        return result

    async def clear_inactive(self, table_name: str, player_id: str) -> None:
        """Remove player from inactive tracking (after forced leave)."""
        async with self._lock:
            self._inactive_since.pop((table_name, player_id), None)

    async def broadcast_table(self, table_name: str, state: dict) -> None:
        """Send state to all clients subscribed to this table."""
        async with self._lock:
            conns = list(self._connections.get(table_name, []))
            state = {**state, "active_player_ids": self._get_active_player_ids(table_name)}
        dead_ws = []
        for ws, _ in conns:
            try:
                await ws.send_text(json.dumps(state))
            except Exception:
                dead_ws.append(ws)
        if dead_ws:
            async with self._lock:
                s = self._connections.get(table_name)
                if s:
                    for ws in dead_ws:
                        to_discard = next((x for x in s if x[0] == ws), None)
                        if to_discard:
                            s.discard(to_discard)


manager = ConnectionManager()
