"use strict";

const crypto = require("crypto");

class SessionStore {
  constructor(options) {
    this.cookieName = options.cookieName || "autodetector_session";
    this.password = options.password;
    this.ttlMs = options.ttlMs || 12 * 60 * 60 * 1000;
    this.sessions = new Map();
  }

  parseCookies(header) {
    const cookies = {};
    for (const part of String(header || "").split(";")) {
      const index = part.indexOf("=");
      if (index <= 0) continue;
      const name = part.slice(0, index).trim();
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    }
    return cookies;
  }

  isAuthenticated(req) {
    const sessionId = this.parseCookies(req.headers.cookie)[this.cookieName];
    if (!sessionId) return false;
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return false;
    }
    session.expiresAt = Date.now() + this.ttlMs;
    return true;
  }

  verifyPassword(value) {
    const left = Buffer.from(String(value));
    const right = Buffer.from(String(this.password));
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  }

  createCookie() {
    const sessionId = crypto.randomBytes(32).toString("base64url");
    this.sessions.set(sessionId, { expiresAt: Date.now() + this.ttlMs });
    return `${this.cookieName}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/`;
  }

  clearCookie(req) {
    const sessionId = this.parseCookies(req.headers.cookie)[this.cookieName];
    if (sessionId) this.sessions.delete(sessionId);
    return `${this.cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  }
}

module.exports = { SessionStore };
