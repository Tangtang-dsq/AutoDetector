"use strict";

const fs = require("fs");
const path = require("path");

class StorageAiSettings {
  constructor(options) {
    const defaults = options && options.defaults ? options.defaults : {};
    this.filePath = path.resolve(options && options.filePath ? options.filePath : path.resolve(process.cwd(), "storage-ai.settings.json"));
    this.state = {
      baseUrl: sanitizeString(defaults.baseUrl) || "https://lucen.run",
      model: sanitizeString(defaults.model) || "gpt-5.4",
      apiKey: sanitizeString(defaults.apiKey),
      timeoutMs: sanitizePositiveInt(defaults.timeoutMs, 45000),
    };
    this.loadFromDisk();
  }

  loadFromDisk() {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw || "{}");
      this.applyUpdate(parsed, { persist: false, keepExistingKey: true });
    } catch {
    }
  }

  getResolved() {
    return { ...this.state };
  }

  getPublic() {
    return {
      base_url: this.state.baseUrl,
      model: this.state.model,
      timeout_ms: this.state.timeoutMs,
      has_api_key: Boolean(this.state.apiKey),
      api_key_masked: maskApiKey(this.state.apiKey),
    };
  }

  update(next) {
    this.applyUpdate(next, { persist: true, keepExistingKey: false });
    return this.getPublic();
  }

  applyUpdate(next, options) {
    const persist = Boolean(options && options.persist);
    const keepExistingKey = Boolean(options && options.keepExistingKey);

    if (Object.prototype.hasOwnProperty.call(next, "base_url") || Object.prototype.hasOwnProperty.call(next, "baseUrl")) {
      this.state.baseUrl = sanitizeString(next.base_url || next.baseUrl) || this.state.baseUrl;
    }
    if (Object.prototype.hasOwnProperty.call(next, "model")) {
      this.state.model = sanitizeString(next.model) || this.state.model;
    }
    if (Object.prototype.hasOwnProperty.call(next, "timeout_ms") || Object.prototype.hasOwnProperty.call(next, "timeoutMs")) {
      this.state.timeoutMs = sanitizePositiveInt(next.timeout_ms || next.timeoutMs, this.state.timeoutMs);
    }
    if (Object.prototype.hasOwnProperty.call(next, "api_key") || Object.prototype.hasOwnProperty.call(next, "apiKey")) {
      const incomingKey = sanitizeString(next.api_key || next.apiKey);
      if (incomingKey) this.state.apiKey = incomingKey;
      else if (!keepExistingKey) this.state.apiKey = "";
    }
    if (persist) this.saveToDisk();
  }

  saveToDisk() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify({
      base_url: this.state.baseUrl,
      model: this.state.model,
      api_key: this.state.apiKey,
      timeout_ms: this.state.timeoutMs,
    }, null, 2));
  }
}

function sanitizeString(value) {
  return String(value || "").trim();
}

function sanitizePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function maskApiKey(apiKey) {
  const value = sanitizeString(apiKey);
  if (!value) return "";
  if (value.length <= 8) return `${value.slice(0, 2)}***${value.slice(-2)}`;
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

module.exports = { StorageAiSettings };
