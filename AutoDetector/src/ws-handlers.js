"use strict";

const { acceptWebSocket } = require("./simple-websocket");

function handleUpgrade(req, socket, registry, sessions) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname !== "/ws/ui" && url.pathname !== "/ws/agent") {
    socket.destroy();
    return;
  }
  if (url.pathname === "/ws/ui" && !sessions.isAuthenticated(req)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const ws = acceptWebSocket(req, socket);
  if (url.pathname === "/ws/ui") handleUiSocket(ws, registry);
  else handleAgentSocket(ws, registry);
}

function handleUiSocket(ws, registry) {
  registry.addUiClient(ws);
}

function handleAgentSocket(ws, registry) {
  let session = null;
  ws.onMessage((text) => {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }

    if (!session) {
      if (message.type !== "hello" || !message.agent_id) {
        ws.socket.end();
        return;
      }
      session = registry.registerAgent(String(message.agent_id), String(message.hostname || ""), ws);
      return;
    }

    registry.markSeen(session);
    if (message.type === "ping") return;
    if (message.type === "drives") registry.updateDrives(session, message.drives);
    else if (message.type === "response") registry.handleAgentResponse(session, message);
  });

  ws.onClose(() => registry.removeAgent(session));
}

module.exports = { handleUpgrade };
