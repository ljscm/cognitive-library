import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchDeepSeekShare } from '../lib/deepseek-share.js';

const url = 'https://chat.deepseek.com/share/abc123';
const data = { code: 0, data: { biz_code: 0, biz_data: { title: 'Shared Conversation', messages: [
  { role: 'USER', status: 'FINISHED', fragments: [{ type: 'REQUEST', content: 'Question' }] },
  { role: 'ASSISTANT', status: 'FINISHED', fragments: [{ type: 'THINK', content: 'private thought' }, { type: 'RESPONSE', content: 'Answer' }] },
] } } };
const response = (body = data, init = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), init);
const mock = (body = data, init = {}) => async () => response(body, init);

test('extracts only conversation content in order with fixed anonymous request', async () => {
  let seen;
  const result = await fetchDeepSeekShare(url, { fetch: async (...args) => { seen = args; return response(); } });
  assert.equal(seen[0], 'https://chat.deepseek.com/api/v0/share/content?share_id=abc123');
  assert.equal(seen[1].redirect, 'error');
  assert.equal(seen[1].credentials, 'omit');
  assert.deepEqual(result, { title: 'Shared Conversation', messages: [{ role: 'USER', content: 'Question' }, { role: 'ASSISTANT', content: 'Answer' }] });
});

test('rejects untrusted or ambiguous URLs before fetch', async () => {
  for (const u of ['http://chat.deepseek.com/share/abc', 'https://chat.deepseek.com.evil.org/share/abc', 'https://evil.org@chat.deepseek.com/share/abc', 'https://chat.deepseek.com:443/share/abc', 'https://chat.deepseek.com/share/abc?x=1', 'https://chat.deepseek.com/share/../abc', 'https://chat.deepseek.com/share/%61bc']) {
    await assert.rejects(fetchDeepSeekShare(u, { fetch: () => { throw new Error('must not fetch'); } }), /Invalid DeepSeek share URL/);
  }
});

test('rejects redirects, http failures and business errors', async () => {
  await assert.rejects(fetchDeepSeekShare(url, { fetch: mock('', { status: 302, headers: { location: 'https://example.com' } }) }), /Redirect/);
  await assert.rejects(fetchDeepSeekShare(url, { fetch: mock('', { status: 500 }) }), /HTTP 500/);
  await assert.rejects(fetchDeepSeekShare(url, { fetch: mock({ code: 0, data: { biz_code: 1, biz_msg: 'share does not exist' } }) }), /share does not exist/);
});

test('enforces body size and detects malformed or truncated data', async () => {
  await assert.rejects(fetchDeepSeekShare(url, { fetch: mock(), maxBytes: 10 }), /too large/);
  await assert.rejects(fetchDeepSeekShare(url, { fetch: mock('{"code":0') }), /truncated/);
  const bad = structuredClone(data);
  bad.data.biz_data.messages[1].status = 'INCOMPLETE';
  await assert.rejects(fetchDeepSeekShare(url, { fetch: mock(bad) }), /Incomplete/);
  bad.data.biz_data.messages[1].status = 'FINISHED';
  bad.data.biz_data.messages[1].fragments.pop();
  await assert.rejects(fetchDeepSeekShare(url, { fetch: mock(bad) }), /Missing/);
});

test('timeout and abort work even if fetch does not cooperate', async () => {
  const never = () => new Promise(() => {});
  await assert.rejects(fetchDeepSeekShare(url, { fetch: never, timeoutMs: 10 }), /timed out/);
  const controller = new AbortController();
  const task = fetchDeepSeekShare(url, { fetch: never, signal: controller.signal });
  controller.abort();
  await assert.rejects(task, /abort/i);
  const already = new AbortController();
  already.abort();
  await assert.rejects(fetchDeepSeekShare(url, { fetch: never, signal: already.signal }), /abort/i);
});
