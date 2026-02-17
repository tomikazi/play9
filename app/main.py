import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from typing import Optional

from pydantic import BaseModel

from app.game import (
    add_player_to_table,
    reveal_card,
    start_game,
    validate_table_name,
    TableState,
)
from app.ws import manager

app = FastAPI(title="Play Nine")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
STATIC_DIR.mkdir(exist_ok=True)


class JoinRequest(BaseModel):
    table_name: str
    player_name: Optional[str] = None


@app.get("/play9")
async def lobby():
    """Serve the lobby view (main entry point)."""
    return FileResponse(STATIC_DIR / "lobby.html")


@app.post("/play9/join")
async def join_table(req: JoinRequest):
    """Join a table as player, or enter as table view only (no player name)."""
    ok, table_name = validate_table_name(req.table_name)
    if not ok:
        raise HTTPException(status_code=400, detail=table_name)
    player_name = (req.player_name or "").strip()
    if not player_name:
        return {"table_name": table_name}
    player, _, err = add_player_to_table(req.table_name, player_name)
    if err:
        raise HTTPException(status_code=400, detail=err)
    table = TableState.load(table_name)
    await manager.broadcast_table(table_name, table.to_dict())
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
    await manager.broadcast_table(tn, table.to_dict())
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
    await manager.broadcast_table(tn, table.to_dict())
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
        TableState._path(tn).unlink(missing_ok=True)
    else:
        table.save()
    state = table.to_dict() if table.players else {"phase": "empty", "players": []}
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
    if action == "ping":
        state = table.to_dict() if table else {"phase": "empty", "players": []}
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
        return table.to_dict()
    if action == "reveal":
        if not player_id:
            return {"error": "Player ID required"}
        idx = msg.get("card_index", -1)
        err = reveal_card(table, player_id, idx)
        if err:
            return {"error": err}
        table.save()
        return table.to_dict()
    if action == "leave":
        if not player_id:
            return {"error": "Player ID required"}
        table.players = [p for p in table.players if p.id != player_id]
        if not table.players:
            TableState._path(tn).unlink(missing_ok=True)
            state = {"phase": "empty", "players": []}
        else:
            table.save()
            state = table.to_dict()
        return state
    return {"error": f"Unknown action: {action}"}


@app.websocket("/play9/ws/{table_name}")
async def websocket_endpoint(websocket: WebSocket, table_name: str):
    """WebSocket: receives actions (start, reveal, leave, ping), broadcasts state."""
    ok, tn = validate_table_name(table_name)
    if not ok:
        await websocket.close(code=4000)
        return
    player_id = websocket.query_params.get("id")
    await manager.connect(websocket, tn, player_id)
    table = TableState.load(tn)
    state = table.to_dict() if table else {"phase": "empty", "players": []}
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
        return {"phase": "empty", "players": []}
    return table.to_dict()


# Mount static assets (CSS, JS) under /play9/static
app.mount("/play9/static", StaticFiles(directory=STATIC_DIR), name="static")
