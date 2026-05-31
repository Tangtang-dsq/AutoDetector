"use strict";

function readArg(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function readConfig(argv, env) {
  return {
    host: readArg(argv, "--host", "0.0.0.0"),
    port: Number(readArg(argv, "--port", "8000")),
    agentTimeoutMs: Number(readArg(argv, "--agent-timeout-ms", "15000")),
    adminPassword: readArg(argv, "--password", env.AUTODETECTOR_PASSWORD || "12345678"),
    storageAiBaseUrl: readArg(argv, "--storage-ai-base-url", env.AUTODETECTOR_STORAGE_AI_BASE_URL || "https://lucen.run"),
    storageAiModel: readArg(argv, "--storage-ai-model", env.AUTODETECTOR_STORAGE_AI_MODEL || "gpt-5.4"),
    storageAiApiKey: readArg(argv, "--storage-ai-api-key", env.AUTODETECTOR_STORAGE_AI_API_KEY || ""),
    storageAiTimeoutMs: Number(readArg(argv, "--storage-ai-timeout-ms", env.AUTODETECTOR_STORAGE_AI_TIMEOUT_MS || "45000")),
    storageAiConfigPath: readArg(argv, "--storage-ai-config-path", env.AUTODETECTOR_STORAGE_AI_CONFIG_PATH || "storage-ai.settings.json"),
  };
}

module.exports = { readConfig };
