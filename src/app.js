"use strict";

const http = require("http");
const path = require("path");
const { AgentRegistry } = require("./agent-registry");
const { createRequestHandler } = require("./routes");
const { SessionStore } = require("./session-store");
const { StorageAiSettings } = require("./storage-ai-settings");
const { createStorageAssistant } = require("./storage-assistant");
const { handleUpgrade } = require("./ws-handlers");

function createApp(config) {
  const publicDir = path.resolve(__dirname, "..", "public");
  const registry = new AgentRegistry({ agentTimeoutMs: config.agentTimeoutMs });
  const sessions = new SessionStore({ password: config.adminPassword });
  const storageAiSettings = new StorageAiSettings({
    filePath: config.storageAiConfigPath,
    defaults: {
      baseUrl: config.storageAiBaseUrl,
      model: config.storageAiModel,
      apiKey: config.storageAiApiKey,
      timeoutMs: config.storageAiTimeoutMs,
    },
  });
  const storageAssistant = createStorageAssistant({
    registry,
    getAiConfig: () => storageAiSettings.getResolved(),
  });
  const server = http.createServer(createRequestHandler({ registry, sessions, publicDir, storageAssistant, storageAiSettings }));

  server.on("upgrade", (req, socket) => handleUpgrade(req, socket, registry, sessions));
  const staleTimer = setInterval(() => registry.removeStaleAgents(), 3000);
  staleTimer.unref();

  return {
    server,
    listen(callback) {
      server.listen(config.port, config.host, callback);
    },
    close(callback) {
      clearInterval(staleTimer);
      server.close(callback);
    },
  };
}

module.exports = { createApp };
