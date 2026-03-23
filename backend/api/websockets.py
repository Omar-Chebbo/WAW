"""
backend/api/websockets.py
Manages WebSocket connections so the backend can push
real-time progress messages to the correct browser session.
"""
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger  = logging.getLogger(__name__)
router  = APIRouter()


class WebSocketManager:
    """Tracks all active WebSocket connections, keyed by session_id."""

    def __init__(self):
        # { session_id: [WebSocket, ...] }
        self._connections: dict[str, list[WebSocket]] = {}

    async def connect(self, session_id: str, ws: WebSocket):
        await ws.accept()
        self._connections.setdefault(session_id, []).append(ws)
        logger.info(f"WS connected: {session_id}")

    def disconnect(self, session_id: str, ws: WebSocket):
        conns = self._connections.get(session_id, [])
        if ws in conns:
            conns.remove(ws)
        logger.info(f"WS disconnected: {session_id}")

    async def broadcast(self, session_id: str, message: dict):
        """Send a JSON message to every browser tab listening on this session."""
        conns = self._connections.get(session_id, [])
        dead  = []
        for ws in conns:
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(session_id, ws)


# Singleton used by all other services
ws_manager = WebSocketManager()


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await ws_manager.connect(session_id, websocket)
    try:
        # Keep alive — the browser sends a ping every 30 s
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(session_id, websocket)
