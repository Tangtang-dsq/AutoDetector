"use strict";

const crypto = require("crypto");
const { httpError } = require("./http-utils");

class AgentRegistry {
  constructor(options) {
    this.agentTimeoutMs = options.agentTimeoutMs;
    this.agents = new Map();
    this.uiClients = new Set();
  }

  snapshot() {
    return [...this.agents.values()]
      .sort((a, b) => a.agentId.localeCompare(b.agentId))
      .map((agent) => ({
        agent_id: agent.agentId,
        hostname: agent.hostname,
        connected_at: agent.connectedAt,
        last_seen: agent.lastSeen,
        drives: agent.drives,
      }));
  }

  broadcastState() {
    const payload = JSON.stringify({ type: "state", agents: this.snapshot() });
    for (const client of [...this.uiClients]) {
      if (!client.closed) client.sendText(payload);
      else this.uiClients.delete(client);
    }
  }

  addUiClient(ws) {
    this.uiClients.add(ws);
    ws.sendText(JSON.stringify({ type: "state", agents: this.snapshot() }));
    ws.onClose(() => this.uiClients.delete(ws));
  }

  registerAgent(agentId, hostname, ws) {
    const old = this.agents.get(agentId);
    if (old) old.socket.socket.end();
    const session = {
      agentId,
      hostname,
      socket: ws,
      connectedAt: Date.now() / 1000,
      lastSeen: Date.now() / 1000,
      drives: [],
      pending: new Map(),
    };
    this.agents.set(agentId, session);
    this.broadcastState();
    return session;
  }

  updateDrives(session, drives) {
    session.drives = Array.isArray(drives) ? drives : [];
    session.lastSeen = Date.now() / 1000;
    this.broadcastState();
  }

  markSeen(session) {
    session.lastSeen = Date.now() / 1000;
  }

  removeAgent(session) {
    if (session && this.agents.get(session.agentId) === session) {
      for (const callback of session.pending.values()) callback({ ok: false, error: "agent disconnected" });
      session.pending.clear();
      this.agents.delete(session.agentId);
      this.broadcastState();
    }
  }

  removeAgentById(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.socket.closed = true;
    try {
      agent.socket.socket.destroy();
    } catch {}
    this.agents.delete(agentId);
    this.broadcastState();
  }

  removeStaleAgents() {
    const now = Date.now() / 1000;
    let changed = false;
    for (const [agentId, agent] of this.agents.entries()) {
      if ((now - agent.lastSeen) * 1000 <= this.agentTimeoutMs) continue;
      for (const callback of agent.pending.values()) callback({ ok: false, error: "agent timed out" });
      agent.pending.clear();
      agent.socket.closed = true;
      try {
        agent.socket.socket.destroy();
      } catch {}
      this.agents.delete(agentId);
      changed = true;
    }
    if (changed) this.broadcastState();
  }

  sendCommand(agentId, command, payload, timeoutMs = 30000) {
    const agent = this.agents.get(agentId);
    if (!agent) return Promise.reject(httpError(404, "agent is not connected"));

    const requestId = crypto.randomUUID();
    const message = JSON.stringify({ type: "command", request_id: requestId, command, payload });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        agent.pending.delete(requestId);
        reject(httpError(504, "agent command timed out"));
      }, timeoutMs);

      agent.pending.set(requestId, (response) => {
        clearTimeout(timer);
        if (!response.ok) reject(httpError(400, response.error || "agent command failed"));
        else resolve(response.result);
      });

      try {
        agent.socket.sendText(message);
      } catch (error) {
        clearTimeout(timer);
        agent.pending.delete(requestId);
        reject(error);
      }
    });
  }

  handleAgentResponse(session, message) {
    const callback = session.pending.get(String(message.request_id || ""));
    if (callback) {
      session.pending.delete(String(message.request_id || ""));
      callback(message);
    }
  }
}

module.exports = { AgentRegistry };
