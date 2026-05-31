"use strict";

const fs = require("fs");
const path = require("path");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function sendHttp(res, status, body, headers = {}) {
  const content = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, { "Content-Length": content.length, ...headers });
  res.end(content);
}

function sendJson(res, status, value, headers = {}) {
  sendHttp(res, status, JSON.stringify(value), { "Content-Type": "application/json; charset=utf-8", ...headers });
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function readBody(req, maxBytes = 16384) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(httpError(413, "request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function contentDisposition(filename) {
  const fallback = Buffer.from(filename, "utf8").toString("latin1").replace(/[^\x20-\x7e]/g, "") || "download.bin";
  return `attachment; filename="${fallback.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function serveStaticFile(res, rootDir, requestPath) {
  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  const decoded = decodeURIComponent(normalized.split("?")[0]);
  const fullPath = path.resolve(rootDir, `.${decoded}`);
  const relativePath = path.relative(rootDir, fullPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendJson(res, 403, { detail: "forbidden" });
    return true;
  }
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return false;
  const type = MIME_TYPES[path.extname(fullPath).toLowerCase()] || "application/octet-stream";
  sendHttp(res, 200, fs.readFileSync(fullPath), { "Content-Type": type });
  return true;
}

module.exports = { contentDisposition, httpError, readBody, sendHttp, sendJson, serveStaticFile };
