/**
 * One-click digest: text in, saved entry out.
 *
 * The model is asked for strict JSON so the host can validate before writing.
 * Rules mirror the `cognitive-library` skill: preserve the source structure,
 * keep its wording, never invent categories.
 */

import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import { saveEntry, listCategories } from './store.js';

export const DIGEST_PURPOSE = 'cognitive-library-digest';
const TIMEOUT_MS = 180_000;
const MAX_INPUT = 60_000;

const SYSTEM = [
  '你是个人认知库的整理员。用户给你一段文字（可能来自对话、文章或笔记），你把它整理成一条可长期保存的条目。',
  '',
  '判断条目类型：',
  '- 能独立成篇（有前因后果、有推进过程）→ article',
  '- 只是一个判断、一条经验、一个结论，三两句说得清 → card',
  '篇幅不是标准，完整度才是。不要为了凑文章而注水，也不要把完整论证压成卡片。',
  '',
  '整理原则：',
  '- 原文有结构就沿用：顺序不改、层级不并、标题不换。只做去重、补连接、修断裂。',
  '- 不要生造概念化标题（如「约束的形状」「失效点」），用原文的功能性说法或直接不加小标题。',
  '- 保留原作用词。作者写「多子多福」，不要改成「生育激励不足」。',
  '- 不要加你自己的评论、反驳、补充案例。你只整理，不发挥。',
  '- 缺少上下文时不要编造内容。',
  '',
  '分类只能从给定的分类列表里选。都不合适就用「待归类」，并在 suggestedCategory 里给一个简短的中文类名建议。',
  '',
  '输出严格 JSON，不要 markdown 代码块，不要解释：',
  '{"type":"article|card","title":"不超过 30 字","category":"分类名或待归类","suggestedCategory":"可选","tags":["2-5 个"],"summary":"一句话结论","body":"Markdown 正文"}',
].join('\n');

function extractJson(raw) {
  const text = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('model did not return JSON');
  return JSON.parse(text.slice(start, end + 1));
}

async function callModel(ctx, route, text, categories, signal) {
  const call = await ctx.llm.prepareCall(
    {
      ...(route.provider && route.model ? { provider: route.provider, model: route.model } : {}),
      maxTokens: 4096,
    },
    signal,
  );
  const messages = [
    createUserMessage({
      content: [{ type: 'text', text: `现有分类：${categories.join('、')}\n\n待整理内容：\n\n${text}` }],
      source: { kind: 'cognitive-library' },
    }),
  ];
  const assembler = new BlockAssembler();
  for await (const chunk of call.stream({ ...call.config, messages, system: SYSTEM, purpose: DIGEST_PURPOSE, signal })) {
    assembler.push(chunk);
  }
  const textOut = assembler
    .blocks()
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  return textOut;
}

/**
 * Digest one piece of text and save it.
 * @param ctx - host plugin context (needs `llm`).
 * @param root - library root.
 * @param input - { text, source, title? }
 * @param route - { provider?, model? }
 */
export async function digestText(ctx, root, input, route = {}) {
  const text = String(input.text ?? '').trim();
  if (!text) throw new Error('text is empty');
  if (text.length > MAX_INPUT) throw new Error(`text exceeds ${MAX_INPUT} characters`);

  const categories = await listCategories(root);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const raw = await callModel(ctx, route, text, categories, signal);
  const parsed = extractJson(raw);

  const category = String(parsed.category ?? '').trim();
  const known = categories.includes(category);
  const entry = await saveEntry(root, {
    type: parsed.type === 'article' ? 'article' : 'card',
    title: String(parsed.title ?? '').trim() || '未命名',
    body: String(parsed.body ?? '').trim(),
    category: known ? category : '待归类',
    tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6) : [],
    summary: String(parsed.summary ?? '').trim(),
    source: input.source ?? { kind: 'text' },
  });

  return {
    id: entry.id,
    title: entry.title,
    type: entry.type,
    category: entry.category,
    tags: entry.tags,
    summary: entry.summary,
    path: entry.path,
    suggestedCategory: known ? '' : String(parsed.suggestedCategory ?? '').trim(),
  };
}
