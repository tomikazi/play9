import asyncio
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from typing import Optional

from pydantic import BaseModel

from app.game import (
    add_player_to_table,
    advance_from_scoring,
    draw_from_discard,
    draw_from_draw,
    find_player_by_name,
    play_discard_flip,
    play_discard_only,
    play_put_back,
    play_flip_after_discard,
    play_replace,
    reset_table_to_empty,
    restart_game,
    reveal_card,
    start_game,
    validate_table_name,
    TableState,
)
from app.ws import manager, CLEANUP_INTERVAL

app = FastAPI(title="Play Nine")

def _empty_table_state(table_name: str = "") -> dict:
    """State when table has no players or doesn't exist."""
    return {
        "name": table_name,
        "phase": "empty",
        "players": [],
        "round_num": 0,
        "current_player_idx": 0,
        "draw_pile_count": 108,
        "discard_pile_count": 0,
        "discard_pile_top": [],
        "dealer_idx": 0,
        "scores": {},
    }


async def _broadcast_table_state(table_name: str) -> None:
    """Load table state and broadcast to all connected clients."""
    table = TableState.load(table_name)
    state = table.to_public_dict() if table else _empty_table_state(table_name)
    await manager.broadcast_table(table_name, state)


async def _force_leave_inactive_players() -> None:
    """Remove players inactive for over 60 seconds from their tables."""
    to_remove = await manager.get_players_inactive_over_60s()
    for table_name, player_id in to_remove:
        table = TableState.load(table_name)
        if not table:
            await manager.clear_inactive(table_name, player_id)
            continue
        if not any(p.id == player_id for p in table.players):
            await manager.clear_inactive(table_name, player_id)
            continue
        table.players = [p for p in table.players if p.id != player_id]
        await manager.clear_inactive(table_name, player_id)
        if not table.players:
            reset_table_to_empty(table)
        table.save()
        state = table.to_public_dict()
        await manager.broadcast_table(table_name, state)


@app.on_event("startup")
async def start_cleanup_task() -> None:
    """Background tasks: disconnect stale connections, force-leave inactive players."""

    async def cleanup_loop() -> None:
        while True:
            await asyncio.sleep(CLEANUP_INTERVAL)
            await manager.cleanup_stale_connections(_broadcast_table_state)
            await _force_leave_inactive_players()

    asyncio.create_task(cleanup_loop())

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
STATIC_DIR.mkdir(exist_ok=True)


class JoinRequest(BaseModel):
    table_name: str
    player_name: Optional[str] = None


@app.get("/play9")
async def lobby():
    """Serve the lobby view (main entry point)."""
    return FileResponse(STATIC_DIR / "lobby.html")


ALREADY_CONNECTED_MSG = "Player already connected elsewhere"


def _ensure_table_exists(table_name: str) -> TableState:
    """Create table with no-game state if it doesn't exist. Returns the table."""
    table = TableState.load(table_name)
    if not table:
        table = TableState(name=table_name)
        reset_table_to_empty(table)
        table.save()
    return table


@app.post("/play9/join")
async def join_table(req: JoinRequest):
    """Join a table as player, or enter as table view only (no player name)."""
    ok, table_name = validate_table_name(req.table_name)
    if not ok:
        raise HTTPException(status_code=400, detail=table_name)
    table = _ensure_table_exists(table_name)
    player_name = (req.player_name or "").strip()
    if not player_name:
        await manager.broadcast_table(table_name, table.to_public_dict())
        return {"table_name": table_name}
    existing = find_player_by_name(table, player_name)
    if existing:
        if await manager.is_player_connected(table_name, existing.id):
            raise HTTPException(status_code=400, detail=ALREADY_CONNECTED_MSG)
        table = TableState.load(table_name)
        await manager.broadcast_table(table_name, table.to_public_dict())
        return {"player_id": existing.id, "table_name": table_name}
    player, _, err = add_player_to_table(req.table_name, player_name)
    if err:
        raise HTTPException(status_code=400, detail=err)
    table = TableState.load(table_name)
    await manager.broadcast_table(table_name, table.to_public_dict())
    return {"player_id": player.id, "table_name": table_name}


class StartRequest(BaseModel):
    table_name: str
    player_id: str


@app.post("/play9/start")
async def start_table_game(req: StartRequest):
    """Start the game (deal cards, enter reveal phase)."""
    ok, tn = validate_table_name(req.table_name)
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid table name")
    table = TableState.load(tn)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    if not any(p.id == req.player_id for p in table.players):
        raise HTTPException(status_code=403, detail="Not a player at this table")
    err = start_game(table)
    if err:
        raise HTTPException(status_code=400, detail=err)
    table.save()
    await manager.broadcast_table(tn, table.to_public_dict())
    return {"ok": True}


class RevealRequest(BaseModel):
    table_name: str
    player_id: str
    card_index: int


@app.post("/play9/reveal")
async def reveal_card_endpoint(req: RevealRequest):
    """Flip a card face-up during the reveal phase."""
    ok, tn = validate_table_name(req.table_name)
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid table name")
    table = TableState.load(tn)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    err = reveal_card(table, req.player_id, req.card_index)
    if err:
        raise HTTPException(status_code=400, detail=err)
    table.save()
    await manager.broadcast_table(tn, table.to_public_dict())
    return {"ok": True}


class LeaveRequest(BaseModel):
    table_name: str
    player_id: str


@app.post("/play9/leave")
async def leave_table(req: LeaveRequest):
    """Remove a player from a table and broadcast update."""
    ok, tn = validate_table_name(req.table_name)
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid table name")
    table = TableState.load(tn)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    table.players = [p for p in table.players if p.id != req.player_id]
    if not table.players:
        reset_table_to_empty(table)
    table.save()
    state = table.to_public_dict()
    await manager.broadcast_table(tn, state)
    return {"ok": True}


@app.get("/play9/table/{table_name}")
async def table_view(table_name: str):
    """Serve the table/waiting room/player view (same resource, id param distinguishes)."""
    ok, _ = validate_table_name(table_name)
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid table name")
    return FileResponse(STATIC_DIR / "table.html")


async def _handle_ws_action(tn: str, player_id: str | None, msg: dict) -> dict | None:
    """Process a WebSocket action. Returns state dict on success, or error dict."""
    action = msg.get("type")
    table = TableState.load(tn)
    if not table and action != "ping":
        return {"error": "Table not found"}
    if action == "ping" or action == "heartbeat":
        state = table.to_public_dict() if table else _empty_table_state(tn)
        return state
    if action == "start":
        if not player_id:
            return {"error": "Player ID required"}
        if not any(p.id == player_id for p in table.players):
            return {"error": "Not a player at this table"}
        err = start_game(table)
        if err:
            return {"error": err}
        table.save()
        return table.to_public_dict()
    if action == "reveal":
        if not player_id:
            return {"error": "Player ID required"}
        idx = msg.get("card_index", -1)
        err = reveal_card(table, player_id, idx)
        if err:
            return {"error": err}
        table.save()
        return table.to_public_dict()
    if action == "draw_from_draw":
        if not player_id:
            return {"error": "Player ID required"}
        err = draw_from_draw(table, player_id)
        if err:
            return {"error": err}
        table.save()
        return table.to_public_dict()
    if action == "draw_from_discard":
        if not player_id:
            return {"error": "Player ID required"}
        err = draw_from_discard(table, player_id)
        if err:
            return {"error": err}
        table.save()
        return table.to_public_dict()
    if action == "play_replace":
        if not player_id:
            return {"error": "Player ID required"}
        err = play_replace(table, player_id, msg.get("card_index", -1))
        if err:
            return {"error": err}
        table.save()
        return table.to_public_dict()
    if action == "play_discard_flip":
        if not player_id:
            return {"error": "Player ID required"}
        err = play_discard_flip(table, player_id, msg.get("card_index", -1))
        if err:
            return {"error": err}
        table.save()
        return table.to_public_dict()
    if action == "play_discard_only":
        if not player_id:
            return {"error": "Player ID required"}
        err = play_discard_only(table, player_id)
        if err:
            return {"error": err}
        table.save()
        return table.to_public_dict()
    if action == "play_put_back":
        if not player_id:
            return {"error": "Player ID required"}
        err = play_put_back(table, player_id)
        if err:
            return {"error": err}
        table.save()
        return table.to_public_dict()
    if action == "play_flip_after_discard":
        if not player_id:
            return {"error": "Player ID required"}
        err = play_flip_after_discard(table, player_id, msg.get("card_index", -1))
        if err:
            return {"error": err}
        table.save()
        return table.to_public_dict()
    if action == "advance_scoring":
        err = advance_from_scoring(table)
        if err:
            return {"error": err}
        table.save()
        return table.to_public_dict()
    if action == "restart":
        err = restart_game(table)
        if err:
            return {"error": err}
        table.save()
        return table.to_public_dict()
    if action == "leave":
        if not player_id:
            return {"error": "Player ID required"}
        table.players = [p for p in table.players if p.id != player_id]
        if not table.players:
            reset_table_to_empty(table)
        table.save()
        return table.to_public_dict()
    return {"error": f"Unknown action: {action}"}


@app.websocket("/play9/ws/{table_name}")
async def websocket_endpoint(websocket: WebSocket, table_name: str):
    """WebSocket: receives actions (start, reveal, leave, ping), broadcasts state."""
    ok, tn = validate_table_name(table_name)
    if not ok:
        await websocket.close(code=4000)
        return
    await websocket.accept()
    player_id = websocket.query_params.get("id")
    if player_id and await manager.is_player_connected(tn, player_id):
        await websocket.send_text(json.dumps({"error": ALREADY_CONNECTED_MSG}))
        await websocket.close()
        return
    await manager.connect(websocket, tn, player_id)
    table = TableState.load(tn)
    state = table.to_public_dict() if table else _empty_table_state(tn)
    state["active_player_ids"] = await manager.get_active_player_ids(tn)
    try:
        await websocket.send_text(json.dumps(state))
    except Exception:
        await manager.disconnect(websocket, tn)
        return
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "heartbeat":
                await manager.record_heartbeat(websocket, tn)
            result = await _handle_ws_action(tn, player_id, msg)
            if result is None:
                continue
            if "error" in result:
                try:
                    await websocket.send_text(json.dumps(result))
                except Exception:
                    pass
            else:
                await manager.broadcast_table(tn, result)
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket, tn)


@app.get("/play9/api/table/{table_name}")
async def get_table_state(table_name: str):
    """Get current table state (for polling or WebSocket fallback)."""
    ok, tn = validate_table_name(table_name)
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid table name")
    table = TableState.load(tn)
    if not table:
        state = _empty_table_state(tn)
        state["active_player_ids"] = await manager.get_active_player_ids(tn)
        return state
    state = table.to_public_dict()
    state["active_player_ids"] = await manager.get_active_player_ids(tn)
    return state


# Mount static assets (CSS, JS) under /play9/static
app.mount("/play9/static", StaticFiles(directory=STATIC_DIR), name="static")
