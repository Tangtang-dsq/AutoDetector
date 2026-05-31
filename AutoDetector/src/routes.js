"use strict";

const { contentDisposition, httpError, readBody, sendHttp, sendJson, serveStaticFile } = require("./http-utils");

function createRequestHandler(options) {
  const { registry, sessions, publicDir } = options;

  return async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    try {
      if (req.method === "GET" && url.pathname === "/favicon.ico") {
        sendHttp(res, 204, "");
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/login") {
        const body = await readBody(req);
        let payload;
        try {
          payload = JSON.parse(body || "{}");
        } catch {
          throw httpError(400, "invalid JSON");
        }
        if (!sessions.verifyPassword(payload.password || "")) throw httpError(401, "password is incorrect");
        sendJson(res, 200, { ok: true }, { "Set-Cookie": sessions.createCookie() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/logout") {
        sendJson(res, 200, { ok: true }, { "Set-Cookie": sessions.clearCookie(req) });
        return;
      }

      if (url.pathname.startsWith("/api/") && !sessions.isAuthenticated(req)) {
        sendJson(res, 401, { detail: "authentication required" });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agents") {
        sendJson(res, 200, registry.snapshot());
        return;
      }

      const shutdownMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/shutdown$/);
      if (req.method === "POST" && shutdownMatch) {
        const agentId = decodeURIComponent(shutdownMatch[1]);
        const result = await registry.sendCommand(agentId, "shutdown", {}, 10000);
        registry.removeAgentById(agentId);
        sendJson(res, 200, result || { ok: true });
        return;
      }

      const listMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/list$/);
      if (req.method === "GET" && listMatch) {
        const result = await registry.sendCommand(decodeURIComponent(listMatch[1]), "list_dir", {
          path: url.searchParams.get("path") || "",
        });
        sendJson(res, 200, result);
        return;
      }

      const downloadMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/download$/);
      if (req.method === "GET" && downloadMatch) {
        const result = await registry.sendCommand(
          decodeURIComponent(downloadMatch[1]),
          "read_file",
          { path: url.searchParams.get("path") || "" },
          120000,
        );
        const filename = result.name || "download.bin";
        sendHttp(res, 200, Buffer.from(result.content_b64 || "", "base64"), {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": contentDisposition(filename),
        });
        return;
      }

      const fileMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/file$/);
      if (fileMatch) {
        const agentId = decodeURIComponent(fileMatch[1]);
        const targetPath = url.searchParams.get("path") || "";
        if (req.method === "GET") {
          const result = await registry.sendCommand(agentId, "read_text_file", { path: targetPath }, 120000);
          sendJson(res, 200, result);
          return;
        }
        if (req.method === "PUT") {
          const body = await readBody(req, 32 * 1024 * 1024);
          let payload;
          try {
            payload = JSON.parse(body || "{}");
          } catch {
            throw httpError(400, "invalid JSON");
          }
          const result = await registry.sendCommand(
            agentId,
            "write_text_file",
            { path: targetPath, content: String(payload.content || "") },
            120000,
          );
          sendJson(res, 200, result);
          return;
        }
        if (req.method === "POST") {
          const body = await readBody(req, 32 * 1024 * 1024);
          let payload;
          try {
            payload = JSON.parse(body || "{}");
          } catch {
            throw httpError(400, "invalid JSON");
          }
          const result = await registry.sendCommand(
            agentId,
            "create_text_file",
            {
              dir: targetPath,
              name: String(payload.name || ""),
              content: String(payload.content || ""),
            },
            120000,
          );
          sendJson(res, 200, result);
          return;
        }
        if (req.method === "DELETE") {
          const result = await registry.sendCommand(agentId, "delete_path", { path: targetPath }, 120000);
          sendJson(res, 200, result);
          return;
        }
      }

      const execMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/exec$/);
      if (req.method === "POST" && execMatch) {
        const agentId = decodeURIComponent(execMatch[1]);
        const body = await readBody(req, 32 * 1024);
        let payload;
        try {
          payload = JSON.parse(body || "{}");
        } catch {
          throw httpError(400, "invalid JSON");
        }
        const command = String(payload.command || "").trim();
        if (!command) throw httpError(400, "command is required");
        const result = await registry.sendCommand(agentId, "exec_cmd", { command }, 120000);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "GET") {
        if (!sessions.isAuthenticated(req)) {
          if (url.pathname === "/" || url.pathname === "/index.html") {
            serveStaticFile(res, publicDir, "/login.html");
            return;
          }
          if (serveStaticFile(res, publicDir, url.pathname)) return;
          sendJson(res, 401, { detail: "authentication required" });
          return;
        }
        if (serveStaticFile(res, publicDir, url.pathname)) return;
      }

      sendJson(res, 404, { detail: "not found" });
    } catch (error) {
      sendJson(res, error.status || 500, { detail: error.message || "internal server error" });
    }
  };
}

module.exports = { createRequestHandler };
