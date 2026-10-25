/**
 * Read a Session's transcript for digesting.
 *
 * Session logs are append-only zstd frames (`session.v4.jsonl.zstd`): one frame
 * per append, so a single decompress call only yields the first event. Frames
 * are split on the zstd magic number and decoded one by one.
 */

import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { zstdDecompressSync } from 'node:zlib';

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

export function sessionsRoot() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, 'sessions');
}

/** Locate one session log across workspace buckets. */
export function findSessionFile(sessionId, root = sessionsRoot()) {
  if (!/^session-[A-Za-z0-9-]{8,}$/.test(String(sessionId))) return null;
  if (!existsSync(root)) return null;
  for (const bucket of readdirSync(root)) {
    const candidate = join(root, bucket, sessionId, 'session.v4.jsonl.zstd');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Decode every zstd frame in an append-only log. */
export function decodeFrames(buffer) {
  const starts = [];
  let index = buffer.indexOf(ZSTD_MAGIC, 0);
  while (index !== -1) {
    starts.push(index);
    index = buffer.indexOf(ZSTD_MAGIC, index + 4);
  }
  let text = '';
  for (let i = 0; i < starts.length; i += 1) {
    const slice = buffer.subarray(starts[i], i + 1 < starts.length ? starts[i + 1] : buffer.length);
    try {
      text += zstdDecompressSync(slice).toString('utf8');
    } catch {
      // A truncated tail frame is expected while a session is still appending.
    }
  }
  return text;
}

function textOf(content) {  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n');
}

/** Runtime scaffolding that rides along as user messages and should not be digested. */
function isScaffold(text) {
  const head = text.slice(0, 120);
  return (
    head.startsWith('Current runtime context.') ||
    head.startsWith('Time sampled while preparing') ||
    head.startsWith('[Image') ||
    text.includes('This snapshot supersedes earlier runtime-context snapshots.')
  );
}

/** Turn decoded JSONL into ordered 用户/助手 turns. */
export function extractTurns(rawText) {
  const turns = [];
  for (const line of rawText.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'user/message') {
      const text = textOf(event.data?.content);
      if (text && !isScaffold(text)) turns.push({ role: '用户', text });
    } else if (event.type === 'assistant/message') {
      const text = textOf(event.data?.message?.content);
      if (text) turns.push({ role: '助手', text });
    }
  }
  return turns;
}

/** Cap a transcript, keeping the opening context and the latest exchange. */
export function capTurns(turns, maxChars = 40_000) {
  const rendered = turns.map((turn) => `${turn.role}：${turn.text}`);
  let total = rendered.reduce((sum, part) => sum + part.length + 1, 0);
  if (total <= maxChars) return { text: rendered.join('\n\n'), truncated: false, turns: turns.length };

  const head = [];
  let headSize = 0;
  const headBudget = Math.floor(maxChars * 0.25);
  for (const part of rendered) {
    if (headSize + part.length > headBudget) break;
    head.push(part);
    headSize += part.length + 1;
  }
  const tail = [];
  let tailSize = 0;
  for (let i = rendered.length - 1; i >= head.length; i -= 1) {
    const part = rendered[i];
    if (tailSize + part.length > maxChars - headSize) break;
    tail.unshift(part);
    tailSize += part.length + 1;
  }
  return {
    text: [...head, '……（中间省略若干轮）……', ...tail].join('\n\n'),
    truncated: true,
    turns: turns.length,
  };
}

/** Full pipeline: session id -> transcript ready for the digest prompt. */
export async function readSessionTranscript(sessionId, options = {}) {
  const file = findSessionFile(sessionId, options.root);
  if (!file) throw new Error(`session not found: ${sessionId}`);
  const raw = decodeFrames(await readFile(file));
  const turns = extractTurns(raw);
  if (!turns.length) throw new Error('session has no user or assistant text yet');
  const capped = capTurns(turns, options.maxChars ?? 40_000);
  return { file, ...capped };
}
