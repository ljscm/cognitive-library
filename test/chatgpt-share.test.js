import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchChatGPTShare } from '../lib/chatgpt-share.js';

const url = 'https://chatgpt.com/share/12345678-1234-1234-1234-123456789abc';
// Synthetic turbo-stream table: keys and values are references, as observed in
// anonymous React Router hydration. No private or network data is used here.
function html(data) {
  const table = [];
  function put(value) {
    const i = table.length; table.push(null);
    if (Array.isArray(value)) table[i] = value.map(put);
    else if (value && typeof value === 'object') {
      const obj = {}; for (const [k, v] of Object.entries(value)) obj['_' + put(k)] = put(v);
      table[i] = obj;
    } else table[i] = value;
    return i;
  }
  put({ loaderData: { 'routes/share.$id': { serverResponse: { data } } } });
  return `<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(JSON.stringify(table) + '\n')});</script>`;
}
const fixture = () => ({ title: 'Example', current_node: 'b', mapping: {
  root: { id: 'root', parent: null },
  a: { id: 'a', parent: 'root', message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['Question'] } } },
  b: { id: 'b', parent: 'a', message: { author: { role: 'assistant' }, content: { content_type: 'multimodal_text', parts: ['Answer', { content_type: 'image_asset_pointer' }, { content_type: 'audio' }] } } },
} });
const mock = (body = html(fixture()), init = {}) => async () => new Response(body, init);

test('reads recognized text in branch order, flags omissions and uses anonymous fetch', async () => {
  let options;
  const result = await fetchChatGPTShare(url, { fetch: async (u, opts) => { assert.equal(u, url); options = opts; return new Response(html(fixture())); } });
  assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
  assert.deepEqual(result.messages, [{ role: 'USER', content: 'Question' }, { role: 'ASSISTANT', content: 'Answer' }]);
  assert.equal(result.title, 'Example'); assert.equal(result.complete, false);
  assert.match(result.warnings.join(' '), /Images were omitted/);
  assert.match(result.warnings.join(' '), /unrecognized content/);
});

test('rejects untrusted URLs before network access', async () => {
  for (const u of ['http://chatgpt.com/share/12345678-1234-1234-1234-123456789abc', 'https://chatgpt.com.evil/share/12345678-1234-1234-1234-123456789abc', 'https://x@chatgpt.com/share/12345678-1234-1234-1234-123456789abc', 'https://chatgpt.com:443/share/12345678-1234-1234-1234-123456789abc', url + '?x=1', url + '#x', url.replace('12345678', '%31345678')]) {
    await assert.rejects(fetchChatGPTShare(u, { fetch: () => { throw Error('unexpected fetch'); } }), /Invalid ChatGPT share URL/);
  }
});

test('refuses redirects, HTTP errors, invalid hydration and oversized bodies', async () => {
  await assert.rejects(fetchChatGPTShare(url, { fetch: mock('', { status: 302 }) }), /Redirect/);
  await assert.rejects(fetchChatGPTShare(url, { fetch: mock('', { status: 429 }) }), /HTTP 429/);
  await assert.rejects(fetchChatGPTShare(url, { fetch: mock('<script>throw new Error()</script>') }), /hydration data missing/);
  await assert.rejects(fetchChatGPTShare(url, { fetch: mock(), maxBytes: 20 }), /too large/);
  await assert.rejects(fetchChatGPTShare(url, { fetch: mock('', { headers: { 'content-length': '1000' } }), maxBytes: 20 }), /too large/);
});

test('warns on unknown content and branches, rejects broken branch', async () => {
  let data = fixture(); data.mapping.b.message.content = { content_type: 'unknown' }; data.mapping.extra = { id: 'extra' };
  let result = await fetchChatGPTShare(url, { fetch: mock(html(data)) });
  assert.match(result.warnings.join(' '), /unrecognized message content/); assert.match(result.warnings.join(' '), /branches/);
  data = fixture(); data.mapping.b.message.channel = 'analysis';
  result = await fetchChatGPTShare(url, { fetch: mock(html(data)) });
  assert.deepEqual(result.messages.map(m => m.role), ['USER']);
  assert.match(result.warnings.join(' '), /channel or recipient was omitted/);
  data.mapping.b.message.channel = 'commentary'; data.mapping.b.message.recipient = 'all';
  result = await fetchChatGPTShare(url, { fetch: mock(html(data)) });
  assert.equal(result.messages.length, 1); assert.match(result.warnings.join(' '), /channel or recipient was omitted/);
  data.mapping.b.message.recipient = 'tool';
  result = await fetchChatGPTShare(url, { fetch: mock(html(data)) });
  assert.equal(result.messages.length, 1);
  data = fixture(); data.mapping.b.message.metadata = { is_visually_hidden_from_conversation: true };
  result = await fetchChatGPTShare(url, { fetch: mock(html(data)) });
  assert.deepEqual(result.messages.map(m => m.role), ['USER']);
  assert.match(result.warnings.join(' '), /Hidden conversation messages were omitted/);
  data = fixture(); data.mapping.a.parent = 'b';
  await assert.rejects(fetchChatGPTShare(url, { fetch: mock(html(data)) }), /branch/);
});

test('enforces timeout and caller abort even with an uncooperative fetch', async () => {
  const never = () => new Promise(() => {});
  await assert.rejects(fetchChatGPTShare(url, { fetch: never, timeoutMs: 10 }), /timed out/);
  const c = new AbortController(); const pending = fetchChatGPTShare(url, { fetch: never, signal: c.signal }); c.abort();
  await assert.rejects(pending, /abort/i);
  await assert.rejects(fetchChatGPTShare(url, { fetch: never, signal: c.signal }), /abort/i);
});
