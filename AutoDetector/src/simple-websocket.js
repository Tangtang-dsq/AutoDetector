"use strict";

const crypto = require("crypto");

function acceptWebSocket(req, socket) {
  const accept = crypto
    .createHash("sha1")
    .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  const ws = new SimpleWebSocket(socket);
  socket.on("data", (chunk) => ws.feed(chunk));
  socket.on("close", () => ws.close());
  socket.on("error", () => ws.close());
  return ws;
}

class SimpleWebSocket {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.messageHandlers = [];
    this.closeHandlers = [];
  }

  onMessage(handler) {
    this.messageHandlers.push(handler);
  }

  onClose(handler) {
    this.closeHandlers.push(handler);
  }

  sendText(text) {
    this.sendFrame(Buffer.from(text), 0x1);
  }

  sendFrame(payload, opcode) {
    if (this.closed) return;
    let header;
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, payload.length]);
    } else if (payload.length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskOffset = masked ? offset : -1;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;

      let payload = this.buffer.subarray(offset, offset + length);
      if (masked) {
        const mask = this.buffer.subarray(maskOffset, maskOffset + 4);
        payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
      }
      this.buffer = this.buffer.subarray(offset + length);

      if (opcode === 0x8) {
        this.socket.end();
        this.close();
      } else if (opcode === 0x9) {
        this.sendFrame(payload, 0xA);
      } else if (opcode === 0x1) {
        const text = payload.toString("utf8");
        for (const handler of this.messageHandlers) handler(text);
      }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const handler of this.closeHandlers) handler();
  }
}

module.exports = { acceptWebSocket };
