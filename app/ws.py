"""WebSocket connection manager for broadcasting game state."""

import asyncio
import json
from typing import Dict, Optional, Set, Tuple

from fastapi import WebSocket


class ConnectionManager:
    """Tracks WebSocket connections per table and broadcasts state updates."""

    def __init__(self) -> None:
        # table_name -> set of (websocket, player_id)
        self._connections: Dict[str, Set[Tuple[WebSocket, Optional[str]]]] = {}
        self._lock = asyncio.Lock()

    async def connect(
        self, websocket: WebSocket, table_name: str, player_id: Optional[str] = None
    ) -> None:
        await websocket.accept()
        async with self._lock:
            if table_name not in self._connections:
                self._connections[table_name] = set()
            self._connections[table_name].add((websocket, player_id))

    async def disconnect(self, websocket: WebSocket, table_name: str) -> None:
        async with self._lock:
            if table_name in self._connections:
                to_remove = [(ws, pid) for ws, pid in self._connections[table_name] if ws == websocket]
                for item in to_remove:
                    self._connections[table_name].discard(item)
                if not self._connections[table_name]:
                    del self._connections[table_name]

    async def broadcast_table(self, table_name: str, state: dict) -> None:
        """Send state to all clients subscribed to this table."""
        async with self._lock:
            conns = list(self._connections.get(table_name, []))
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
