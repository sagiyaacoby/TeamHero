// ── WebSocket Frame Helpers ──────────────────────────────
// Extracted from server.js - zero behavior change

function parseWsFrame(buf) {
  if (buf.length < 2) return null;
  var b0 = buf[0], b1 = buf[1];
  var opcode = b0 & 0x0f;
  var masked = (b1 & 0x80) !== 0;
  var len = b1 & 0x7f;
  var offset = 2;

  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  var maskKey = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    maskKey = buf.slice(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + len) return null;
  var payload = Buffer.from(buf.slice(offset, offset + len));
  if (masked && maskKey) {
    for (var i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
  }

  return { opcode: opcode, payload: payload, totalLen: offset + len };
}

function buildWsFrame(data) {
  var payload = Buffer.from(data, 'utf8');
  var len = payload.length;
  var header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function wsSend(socket, obj) {
  try { socket.write(buildWsFrame(JSON.stringify(obj))); } catch(e) {}
}

module.exports = { parseWsFrame, buildWsFrame, wsSend };
