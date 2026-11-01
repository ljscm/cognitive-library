import { execFile } from 'node:child_process';
import http from 'node:http';
import tls from 'node:tls';

const SHARE = /^https:\/\/chatgpt\.com\/share\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i;
const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

// Read individual values, never shell-expand registry data or include it in errors.
async function readWinInet(signal) {
  if (process.platform !== 'win32') throw new Error('System proxy unavailable');
  const output = await new Promise((resolve, reject) => {
    execFile('reg.exe', ['query', KEY], { windowsHide: true, timeout: 3000, maxBuffer: 65536, signal }, (error, stdout) => {
      if (error) return reject(new Error('System proxy detection failed'));
      resolve(stdout);
    });
  });
  const value = (name) => {
    const line = output.split(/\r?\n/).find(s => new RegExp('^\\s*' + name + '\\s+REG_', 'i').test(s));
    return line?.match(/^\s*\S+\s+REG_\w+\s*(.*?)\s*$/)?.[1];
  };
  // PAC/WPAD are not evaluated; reject explicitly configured auto-proxy.
  if (value('AutoConfigURL') || /^(?:0x0*1|1)$/i.test(value('AutoDetect') || '')) throw new Error('Unsupported system proxy');
  const enabled = value('ProxyEnable');
  if (!/^(?:0x0*1|1)$/i.test(enabled || '')) throw new Error('System proxy unavailable');
  const server = value('ProxyServer');
  if (!server) throw new Error('System proxy detection failed');
  return { enabled: true, server };
}

function parseProxy(config) {
  if (config?.enabled !== true || typeof config.server !== 'string' || config.server.length > 2048) throw new Error('System proxy unavailable');
  let value = config.server.trim();
  if (value.includes('=')) {
    const parts = value.split(';').map(s => s.trim());
    const matches = parts.filter(s => /^https=/i.test(s));
    if (matches.length !== 1 || parts.some(s => !/^(?:http|https|ftp|socks)=[^;\s]+$/i.test(s))) throw new Error('Unsupported system proxy');
    value = matches[0].slice(matches[0].indexOf('=') + 1);
  }
  // Only literal loopback addresses or localhost, no DNS aliases or userinfo.
  if (!/^(?:http:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]):[0-9]{1,5}$/i.test(value)) throw new Error('Unsupported system proxy');
  const parsed = new URL(/^http:\/\//i.test(value) ? value : `http://${value}`);
  const port = Number(value.match(/:(\d+)$/)[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Unsupported system proxy');
  // Resolve localhost ourselves, so a hosts-file override cannot escape loopback.
  return { host: parsed.hostname === '[::1]' ? '::1' : '127.0.0.1', port };
}

/** Narrow fetch adapter. Inject dependencies only in trusted tests, never from share data. */
export function createChatGPTSystemProxyFetch({ readConfig = readWinInet, request = http.request, tlsConnect = tls.connect, timeoutMs = 15000, maxBytes = 8 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid request limits');
  return async function proxyFetch(url, options = {}) {
    if (typeof url !== 'string' || !SHARE.test(url)) throw new Error('Invalid ChatGPT share URL');
    if (options.method && options.method !== 'GET') throw new Error('Unsupported request');
    const signal = options.signal;
    let connectReq, socket, secure, targetReq, incoming, streamController, agent, settled = false, finished = false;
    const detection = new AbortController();
    const result = new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); detection.abort(); };
      const destroy = () => { incoming?.destroy(); targetReq?.destroy(); secure?.destroy(); socket?.destroy(); connectReq?.destroy(); agent?.destroy(); };
      const fail = (message) => {
        if (finished) return;
        finished = true; cleanup(); destroy();
        const error = new Error(message);
        if (!settled) { settled = true; reject(error); } else { try { streamController?.error(error); } catch {} }
      };
      const onAbort = () => fail('ChatGPT share request aborted');
      const timer = setTimeout(() => fail('ChatGPT share request timed out'), timeoutMs);
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      Promise.resolve().then(() => readConfig(detection.signal)).then(config => {
        if (finished) return;
        const proxy = parseProxy(config);
        connectReq = request({ host: proxy.host, port: proxy.port, method: 'CONNECT', path: 'chatgpt.com:443', headers: { Host: 'chatgpt.com:443' }, agent: false });
        connectReq.on('error', () => fail('System proxy connection failed'));
        connectReq.on('connect', (res, raw, head) => {
          socket = raw;
          if (finished) return raw.destroy();
          if (res.statusCode !== 200 || head.length) return fail('System proxy CONNECT failed');
          raw.on('error', () => fail('System proxy connection failed'));
          secure = tlsConnect({ socket: raw, servername: 'chatgpt.com', rejectUnauthorized: true });
          secure.on('error', () => fail('ChatGPT TLS connection failed'));
          secure.once('secureConnect', () => {
            if (finished) return;
            agent = new http.Agent({ keepAlive: false });
            agent.createConnection = () => secure;
            targetReq = request({ host: 'chatgpt.com', port: 443, method: 'GET', path: new URL(url).pathname, agent, headers: { Host: 'chatgpt.com', Accept: 'text/html', 'Accept-Encoding': 'identity', Connection: 'close' } });
            targetReq.on('error', () => fail('ChatGPT share request failed'));
            targetReq.on('response', res2 => {
              incoming = res2;
              incoming.on('error', () => fail('ChatGPT share response failed'));
              incoming.on('aborted', () => fail('ChatGPT share response interrupted'));
              if (res2.statusCode >= 300 && res2.statusCode < 400) return fail('Redirect not allowed');
              if (res2.headers['content-encoding'] && res2.headers['content-encoding'].toLowerCase() !== 'identity') return fail('Unsupported ChatGPT response encoding');
              const len = res2.headers['content-length'];
              if (len && (!/^\d+$/.test(len) || Number(len) > maxBytes)) return fail('ChatGPT share response too large');
              let count = 0;
              const body = new ReadableStream({
                start(controller) {
                  streamController = controller;
                  incoming.pause();
                  incoming.on('data', chunk => {
                    count += chunk.length;
                    if (count > maxBytes) return fail('ChatGPT share response too large');
                    controller.enqueue(new Uint8Array(chunk));
                    if (controller.desiredSize <= 0) incoming.pause();
                  });
                  incoming.once('end', () => { if (!finished) { finished = true; cleanup(); controller.close(); agent?.destroy(); } });
                },
                pull() { incoming.resume(); },
                cancel() { if (!finished) { finished = true; cleanup(); destroy(); } },
              });
              try {
                const headers = new Headers();
                if (res2.headers['content-type']) headers.set('content-type', res2.headers['content-type']);
                if (len) headers.set('content-length', len);
                const noBody = res2.statusCode === 204 || res2.statusCode === 205;
                const response = new Response(noBody ? null : body, { status: res2.statusCode, headers });
                settled = true; resolve(response);
                if (noBody) { finished = true; cleanup(); destroy(); }
              } catch { fail('Invalid ChatGPT share response'); }
            });
            targetReq.end();
          });
        });
        connectReq.end();
      }).catch(() => fail('System proxy detection failed'));
    });
    return result;
  };
}
