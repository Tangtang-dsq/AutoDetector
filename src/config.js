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
  };
}

module.exports = { readConfig };
