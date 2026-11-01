import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createChatGPTSystemProxyFetch } from '../lib/chatgpt-system-proxy.js';

const url = 'https://chatgpt.com/share/12345678-1234-1234-1234-123456789abc';
async function proxy(handler) {
  const server = http.createServer();
  const sockets = new Set();
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  server.on('connect', (req, socket) => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); handler(req, socket); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, sockets, close: () => { for (const s of sockets) s.destroy(); server.close(); } };
}
function adapter(p, options = {}) {
  return createChatGPTSystemProxyFetch({ readConfig: async () => ({ enabled: true, server: `127.0.0.1:${p.server.address().port}` }), tlsConnect: ({ socket, servername, rejectUnauthorized }) => { assert.equal(servername, 'chatgpt.com'); assert.equal(rejectUnauthorized, true); queueMicrotask(() => socket.emit('secureConnect')); return socket; }, ...options });
}
function reply(body, status = '200 OK') {
  return (req, socket) => { assert.equal(req.url, 'chatgpt.com:443'); socket.once('data', data => { const text = data.toString(); assert.match(text, /^GET \/share\//); assert.doesNotMatch(text, /\r\n(?:cookie|authorization|proxy-authorization):/i); socket.write(`HTTP/1.1 ${status}\r\nContent-Length: ${Buffer.byteLength(body)}\r\nContent-Type: text/html\r\n\r\n${body}`); }); };
}

test('CONNECT and streaming Response via injectable TLS transport', async () => {
  const p = await proxy(reply('hello'));
  try { const response = await adapter(p)(url); assert.ok(response instanceof Response); assert.equal(await response.text(), 'hello'); }
  finally { p.close(); }
});

test('rejects unsafe target and configuration without connecting', async () => {
  for (const server of ['http://u:p@127.0.0.1:8888', 'https://127.0.0.1:8888', 'evil.example:80', '127.0.0.2:88', 'localhost:0', 'socks=127.0.0.1:8']) {
    const fetch = createChatGPTSystemProxyFetch({ readConfig: async () => ({ enabled: true, server }), request() { throw Error('called'); } });
    await assert.rejects(fetch(url), e => !e.message.includes(server));
  }
  const disabled = createChatGPTSystemProxyFetch({ readConfig: async () => ({ enabled: false, server: '127.0.0.1:123' }), request() { throw Error('called'); } });
  await assert.rejects(disabled(url), /detection failed/);
  const fetch = createChatGPTSystemProxyFetch({ readConfig: () => { throw Error('called'); } });
  await assert.rejects(fetch(url + '?secret=1'), /Invalid/);
  await assert.rejects(fetch(url, { method: 'POST' }), /Unsupported/);
});

test('refuses redirects and enforces body size', async () => {
  for (const [response, opts, expected] of [[reply('x', '302 Found'), {}, /Redirect/], [reply('123456'), { maxBytes: 2 }, /too large/]]) {
    const p = await proxy(response);
    try { await assert.rejects(adapter(p, opts)(url), expected); } finally { p.close(); }
  }
  const p = await proxy((req, socket) => socket.once('data', () => socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n6\r\n123456\r\n0\r\n\r\n')));
  try { const res = await adapter(p, { maxBytes: 2 })(url); await assert.rejects(res.text(), /too large/); } finally { p.close(); }
});

test('abort, timeout, and reader cancellation settle', async () => {
  const p = await proxy((req, socket) => socket.once('data', () => socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1\r\na\r\n')));
  try {
    const c = new AbortController();
    const response = await adapter(p)(url, { signal: c.signal });
    const reader = response.body.getReader(); assert.equal((await reader.read()).value[0], 97);
    c.abort(); await assert.rejects(reader.read(), /aborted/);
    const other = await adapter(p)(url); await other.body.cancel();
    let detectionSignal;
    const waiting = createChatGPTSystemProxyFetch({ readConfig: s => { detectionSignal = s; return new Promise(() => {}); }, timeoutMs: 10 });
    await assert.rejects(waiting(url), /timed out/); assert.equal(detectionSignal.aborted, true);
  } finally { p.close(); }
});
