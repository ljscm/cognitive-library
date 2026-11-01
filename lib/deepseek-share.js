const API = 'https://chat.deepseek.com/api/v0/share/content';
const DEFAULT_LIMIT = 8 * 1024 * 1024;

/** Fetch a public DeepSeek share without credentials. Only request/response fragments are returned. */
export async function fetchDeepSeekShare(url, { fetch: fetchImpl = globalThis.fetch, signal, timeoutMs = 15000, maxBytes = DEFAULT_LIMIT } = {}) {
  if (typeof url !== 'string' || !/^https:\/\/chat\.deepseek\.com\/share\/[A-Za-z0-9]+\/?$/.test(url)) {
    throw new Error('Invalid DeepSeek share URL');
  }
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('Invalid timeout or response size limit');
  }
  const id = new URL(url).pathname.split('/')[2];
  const controller = new AbortController();
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const abort = (reason) => {
    if (!controller.signal.aborted) {
      const error = reason instanceof Error ? reason : new Error('Operation aborted');
      controller.abort(error);
      rejectAbort(error);
    }
  };
  const onAbort = () => abort(signal.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => abort(new Error('DeepSeek share request timed out')), timeoutMs);
  try {
    return await Promise.race([aborted, (async () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      const response = await fetchImpl(`${API}?share_id=${encodeURIComponent(id)}`, {
        method: 'GET', redirect: 'error', credentials: 'omit', signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (response.redirected || (response.status >= 300 && response.status < 400)) throw new Error('Redirect not allowed');
      if (!response.ok) throw new Error(`DeepSeek share HTTP ${response.status}`);
      const length = response.headers?.get('content-length');
      if (length && /^\d+$/.test(length) && Number(length) > maxBytes) throw new Error('DeepSeek share response too large');
      if (!response.body || typeof response.body.getReader !== 'function') throw new Error('Streaming response body unavailable');
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new Error('DeepSeek share response too large');
          chunks.push(value);
        }
      } catch (error) {
        void reader.cancel().catch(() => {});
        throw error;
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let data;
      try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw new Error('Invalid or truncated DeepSeek share JSON'); }
      if (data?.code !== 0 || data?.data?.biz_code !== 0) throw new Error(`DeepSeek share error: ${data?.data?.biz_msg || data?.msg || 'unknown error'}`);
      const share = data.data.biz_data;
      if (!share || typeof share.title !== 'string' || !Array.isArray(share.messages) || !share.messages.length) throw new Error('Invalid DeepSeek share data');
      const messages = share.messages.map((message) => {
        if (!message || !['USER', 'ASSISTANT'].includes(message.role) || !Array.isArray(message.fragments)) throw new Error('Invalid DeepSeek share message');
        if ((message.status && message.status !== 'FINISHED') || message.incomplete_message != null || message.has_pending_fragment || message.auto_continue) throw new Error('Incomplete DeepSeek share message');
        const type = message.role === 'USER' ? 'REQUEST' : 'RESPONSE';
        const fragments = message.fragments.filter((fragment) => fragment?.type === type);
        if (!fragments.length || fragments.some((fragment) => typeof fragment.content !== 'string')) throw new Error('Missing DeepSeek share content');
        return { role: message.role, content: fragments.map((fragment) => fragment.content).join('') };
      });
      return { title: share.title, messages };
    })()]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
