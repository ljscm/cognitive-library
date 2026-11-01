const DEFAULT_LIMIT = 8 * 1024 * 1024;
const SHARE_URL = /^https:\/\/chatgpt\.com\/share\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i;

// This is a deliberately narrow reader for the observed React Router turbo-stream
// format, not a JavaScript interpreter or a general turbo-stream implementation.
function extractConversation(html) {
  const scripts = html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi);
  const matches = [];
  for (const script of scripts) {
    const re = /(?:window\.)?__reactRouterContext\.streamController\.enqueue\(("(?:\\.|[^"\\])*")\)\s*;?/g;
    for (const match of script[1].matchAll(re)) {
      let chunk;
      try { chunk = JSON.parse(match[1]); } catch { throw new Error('Invalid ChatGPT hydration string'); }
      if (chunk.startsWith('[')) matches.push(chunk);
    }
  }
  if (matches.length !== 1) throw new Error('ChatGPT hydration data missing or ambiguous');
  let table;
  try { table = JSON.parse(matches[0]); } catch { throw new Error('Invalid or truncated ChatGPT hydration data'); }
  if (!Array.isArray(table) || !table.length) throw new Error('Invalid ChatGPT hydration table');
  const deref = (i) => {
    if (!Number.isSafeInteger(i)) throw new Error('Invalid ChatGPT hydration reference');
    if (i === -5 || i === -7) return null;
    if (i < 0 || i >= table.length) throw new Error('Unsupported ChatGPT hydration reference');
    return table[i];
  };
  const get = (obj, key) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
    for (const [k, v] of Object.entries(obj)) {
      if (!/^_\d+$/.test(k)) throw new Error('Unsupported ChatGPT hydration object');
      if (deref(Number(k.slice(1))) === key) return deref(v);
    }
    return undefined;
  };
  const entries = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Invalid ChatGPT mapping');
    return Object.entries(obj).map(([k, v]) => {
      if (!/^_\d+$/.test(k)) throw new Error('Invalid ChatGPT mapping key');
      const key = deref(Number(k.slice(1)));
      if (typeof key !== 'string') throw new Error('Invalid ChatGPT mapping key');
      return [key, deref(v)];
    });
  };
  const loader = get(deref(0), 'loaderData');
  const candidates = entries(loader).map(([, route]) => get(get(route, 'serverResponse'), 'data')).filter(data => get(data, 'mapping') !== undefined);
  if (candidates.length !== 1) throw new Error('ChatGPT conversation data missing or ambiguous');
  const data = candidates[0], title = get(data, 'title');
  const nodes = new Map(entries(get(data, 'mapping')));
  let current = get(data, 'current_node');
  if (typeof title !== 'string' || typeof current !== 'string') throw new Error('Invalid ChatGPT conversation data');
  const warnings = new Set(['Only recognized text from the current branch is extracted; completeness cannot be guaranteed.']);
  const seen = new Set(), ordered = [];
  while (current != null) {
    if (typeof current !== 'string' || seen.has(current) || !nodes.has(current)) throw new Error('Invalid ChatGPT conversation branch');
    seen.add(current);
    const node = nodes.get(current);
    if (get(node, 'id') !== current) throw new Error('Invalid ChatGPT conversation node');
    const msg = get(node, 'message');
    if (msg != null) ordered.push(msg);
    current = get(node, 'parent');
  }
  if (seen.size < nodes.size) warnings.add('Other branches or unreachable nodes were omitted.');
  const messages = [];
  for (const msg of ordered.reverse()) {
    const role = get(get(msg, 'author'), 'role');
    if (role !== 'user' && role !== 'assistant') {
      warnings.add('Non-user/assistant or unrecognized messages were omitted.');
      continue;
    }
    const metadata = get(msg, 'metadata');
    if (get(metadata, 'is_visually_hidden_from_conversation') === true) {
      warnings.add('Hidden conversation messages were omitted.');
      continue;
    }
    const channel = get(msg, 'channel');
    const recipient = get(msg, 'recipient');
    if ((channel != null && channel !== 'final') || (recipient != null && recipient !== 'all')) {
      warnings.add('A non-public or unrecognized message channel or recipient was omitted.');
      continue;
    }
    const content = get(msg, 'content');
    const type = get(content, 'content_type');
    const parts = get(content, 'parts');
    if (!['text', 'multimodal_text'].includes(type) || !Array.isArray(parts)) {
      warnings.add('Unsupported or unrecognized message content was omitted.');
      continue;
    }
    let text = '';
    for (const ref of parts) {
      const part = deref(ref);
      if (typeof part === 'string') text += part;
      else {
        const partType = get(part, 'content_type');
        if (typeof partType === 'string' && /image/i.test(partType)) warnings.add('Images were omitted; image content is not supported.');
        else warnings.add('Multimodal or unrecognized content was omitted.');
      }
    }
    if (type === 'multimodal_text') warnings.add('Multimodal content may be missing or unsupported.');
    if (text) messages.push({ role: role.toUpperCase(), content: text });
    else warnings.add('A message had no recognized text.');
  }
  if (!messages.length) throw new Error('No recognized ChatGPT conversation text was found');
  return { title, messages, warnings: [...warnings], complete: false };
}

/** Fetch an anonymous public share. Never executes scripts or follows redirects. */
export async function fetchChatGPTShare(url, { fetch: fetchImpl = globalThis.fetch, signal, timeoutMs = 15000, maxBytes = DEFAULT_LIMIT } = {}) {
  if (typeof url !== 'string' || !SHARE_URL.test(url)) throw new Error('Invalid ChatGPT share URL');
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid timeout or response size limit');
  const controller = new AbortController();
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const abort = (reason) => {
    if (!controller.signal.aborted) {
      const error = reason instanceof Error ? reason : new Error('Operation aborted');
      controller.abort(error); rejectAbort(error);
    }
  };
  const onAbort = () => abort(signal.reason);
  if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => abort(new Error('ChatGPT share request timed out')), timeoutMs);
  try {
    return await Promise.race([aborted, (async () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      let response;
      try {
        response = await fetchImpl(url, { method: 'GET', redirect: 'error', credentials: 'omit', signal: controller.signal, headers: { Accept: 'text/html' } });
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        const code = error?.cause?.code;
        if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') throw new Error('无法连接 ChatGPT 分享页面：连接超时，请检查 DSH 宿主的网络或粘贴对话正文。');
        throw error;
      }
      if (response.redirected || (response.status >= 300 && response.status < 400)) throw new Error('Redirect not allowed');
      if (!response.ok) {
        if (response.body) void response.body.cancel().catch(() => {});
        throw new Error(`ChatGPT share HTTP ${response.status}`);
      }
      const length = response.headers?.get('content-length');
      if (length && /^\d+$/.test(length) && Number(length) > maxBytes) throw new Error('ChatGPT share response too large');
      if (!response.body || typeof response.body.getReader !== 'function') throw new Error('Streaming response body unavailable');
      const reader = response.body.getReader(), chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new Error('ChatGPT share response too large');
          chunks.push(value);
        }
      } catch (error) { void reader.cancel().catch(() => {}); throw error; }
      const bytes = new Uint8Array(size); let pos = 0;
      for (const chunk of chunks) { bytes.set(chunk, pos); pos += chunk.byteLength; }
      let html;
      try { html = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('Invalid ChatGPT HTML encoding'); }
      return extractConversation(html);
    })()]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}
