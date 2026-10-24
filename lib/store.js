/**
 * cognitive-library core store.
 *
 * Plain Markdown on disk, no database:
 *   <root>/.cogni.json   library metadata (categories, version)
 *   <root>/cards/*.md    short cognition units
 *   <root>/articles/*.md standalone articles
 *   <root>/index.md      generated: entries grouped by category
 *   <root>/graph.md      generated: relations as a Mermaid graph + list
 *   <root>/relations.json generated: relation data (source of truth)
 *
 * Cards and articles are peers. An article is never decomposed into cards.
 */

import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export const VERSION = 1;
export const DEFAULT_CATEGORIES = ['政治', '经济', '科技', '心理', '生活'];
export const TYPES = ['card', 'article'];

/** Resolve the library root: explicit > env > ~/.dsh/cognitive-library. */
export function resolveRoot(explicit) {
  if (explicit) return explicit;
  if (process.env.COGNITIVE_LIBRARY_HOME) return process.env.COGNITIVE_LIBRARY_HOME;
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(dshHome, 'cognitive-library');
}

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${today()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const PUNCT_RE = /[，。、；：！？“”‘’（）【】《》〈〉「」『』—–…·,.;:!?'"()[\]{}]/g;

/** Filesystem-safe slug. A CJK title stays readable; an ASCII title becomes kebab-case. */
export function slugify(title) {
  const cleaned = String(title || '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|#%^~`\r\n\t]/g, ' ')
    .replace(PUNCT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'entry';
  if (CJK_RE.test(cleaned)) {
    return cleaned.replace(/\s+/g, '-').slice(0, 48).replace(/^-+|-+$/g, '') || 'entry';
  }
  const ascii = cleaned.toLowerCase().match(/[a-z0-9]+/g);
  return ascii ? ascii.join('-').slice(0, 48) : 'entry';
}

function metaPath(root) {
  return join(root, '.cogni.json');
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

/** Create the library skeleton; idempotent. */
export async function ensureLibrary(root, options = {}) {
  await mkdir(join(root, 'cards'), { recursive: true });
  await mkdir(join(root, 'articles'), { recursive: true });
  const meta = await readJson(metaPath(root), null);
  if (meta) return meta;
  const created = {
    version: VERSION,
    created: nowStamp(),
    categories: [...(options.categories || DEFAULT_CATEGORIES)],
  };
  await writeJson(metaPath(root), created);
  return created;
}

export async function readMeta(root) {
  await ensureLibrary(root);
  return readJson(metaPath(root), { version: VERSION, categories: [...DEFAULT_CATEGORIES] });
}

export async function listCategories(root) {
  const meta = await readMeta(root);
  return meta.categories;
}

/** Add a category. The caller is responsible for asking the user first. */
export async function addCategory(root, name) {
  const value = String(name || '').trim();
  if (!value) throw new Error('category name is empty');
  const meta = await readMeta(root);
  if (meta.categories.includes(value)) return { added: false, categories: meta.categories };
  meta.categories.push(value);
  await writeJson(metaPath(root), meta);
  return { added: true, categories: meta.categories };
}

export async function renameCategory(root, from, to) {
  const meta = await readMeta(root);
  const index = meta.categories.indexOf(from);
  if (index < 0) throw new Error(`unknown category: ${from}`);
  const target = String(to || '').trim();
  if (!target) throw new Error('new category name is empty');
  meta.categories[index] = target;
  await writeJson(metaPath(root), meta);
  const affected = (await listEntries(root)).filter((e) => e.category === from);
  for (const entry of affected) {
    entry.category = target;
    await writeEntryFile(root, entry);
  }
  await reindex(root);
  return { renamed: true, from, to: target, moved: affected.length };
}

function serialize(entry) {
  const q = (v) => JSON.stringify(v);
  const source = entry.source && entry.source.kind ? entry.source : { kind: 'text' };
  return [
    '---',
    `id: ${q(entry.id)}`,
    `type: ${q(entry.type)}`,
    `title: ${q(entry.title)}`,
    `category: ${q(entry.category)}`,
    `tags: ${JSON.stringify(entry.tags || [])}`,
    `summary: ${q(entry.summary || '')}`,
    `created: ${q(entry.created)}`,
    `updated: ${q(entry.updated || entry.created)}`,
    `source: ${JSON.stringify(source)}`,
    '---',
    '',
    String(entry.body || '').trim(),
    '',
  ].join('\n');
}

function scalar(raw) {
  const value = String(raw || '').trim();
  if (value === '') return '';
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function parseEntry(raw, path = '') {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return null;
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (!key) continue;
    meta[key] = scalar(line.slice(at + 1));
  }
  const entry = {
    id: String(meta.id || ''),
    type: meta.type === 'article' ? 'article' : 'card',
    title: String(meta.title || ''),
    category: String(meta.category || ''),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    summary: String(meta.summary || ''),
    created: String(meta.created || ''),
    updated: String(meta.updated || meta.created || ''),
    source: meta.source && typeof meta.source === 'object' ? meta.source : { kind: 'text' },
    path,
  };
  entry.body = raw.slice(match[0].length).trim();
  return entry;
}

function entryDir(type) {
  return type === 'article' ? 'articles' : 'cards';
}

function entryPath(root, entry) {
  return join(root, entryDir(entry.type), `${entry.id}.md`);
}

async function writeEntryFile(root, entry) {
  const file = entryPath(root, entry);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, serialize(entry), 'utf8');
  await rename(tmp, file);
  return file;
}

function uniqueId(root, date, title) {
  const base = `${date}-${slugify(title)}`;
  let id = base;
  let n = 2;
  while (existsSync(join(root, 'cards', `${id}.md`)) || existsSync(join(root, 'articles', `${id}.md`))) {
    id = `${base}-${n++}`;
  }
  return id;
}

/**
 * Save a card or article.
 * @param {string} root
 * @param {{type?:string,title:string,body:string,category?:string,tags?:string[],
 *          summary?:string,source?:{kind:string,ref?:string},date?:string,id?:string}} input
 */
export async function saveEntry(root, input) {
  await ensureLibrary(root);
  const title = String(input.title || '').trim();
  if (!title) throw new Error('title is required');
  const body = String(input.body || '').trim();
  if (!body) throw new Error('body is required');
  const type = TYPES.includes(input.type) ? input.type : 'card';
  const meta = await readMeta(root);
  const category = String(input.category || '').trim() || '待归类';
  if (category !== '待归类' && !meta.categories.includes(category)) {
    throw new Error(
      `unknown category "${category}". Ask the user whether to create it, then call cognitive_category add. ` +
        `Existing categories: ${meta.categories.join('、')}`,
    );
  }
  const date = input.date || today();
  const entry = {
    id: input.id || uniqueId(root, date, title),
    type,
    title,
    category,
    tags: (input.tags || []).map((t) => String(t).trim()).filter(Boolean),
    summary: String(input.summary || '').trim(),
    created: date,
    updated: date,
    source: input.source && input.source.kind ? input.source : { kind: 'text' },
    body,
  };
  const file = await writeEntryFile(root, entry);
  await reindex(root);
  return { ...entry, path: file };
}

async function readDirEntries(root, dir) {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  const names = (await readdir(full)).filter((n) => n.endsWith('.md'));
  const out = [];
  for (const fileName of names) {
    const file = join(full, fileName);
    const parsed = parseEntry(await readFile(file, 'utf8'), file);
    if (parsed) out.push(parsed);
  }
  return out;
}

export async function listEntries(root, filter = {}) {
  await ensureLibrary(root);
  let entries = [...(await readDirEntries(root, 'cards')), ...(await readDirEntries(root, 'articles'))];
  if (filter.type) entries = entries.filter((e) => e.type === filter.type);
  if (filter.category) entries = entries.filter((e) => e.category === filter.category);
  if (filter.tag) entries = entries.filter((e) => e.tags.includes(filter.tag));
  entries.sort((a, b) => String(b.created).localeCompare(String(a.created)) || a.title.localeCompare(b.title));
  return filter.limit ? entries.slice(0, filter.limit) : entries;
}

export async function getEntry(root, id) {
  for (const dir of ['cards', 'articles']) {
    const file = join(root, dir, `${id}.md`);
    if (existsSync(file)) return parseEntry(await readFile(file, 'utf8'), file);
  }
  return null;
}

export async function searchEntries(root, query, filter = {}) {
  const needle = String(query || '').toLowerCase().trim();
  if (!needle) return [];
  const entries = await listEntries(root, filter);
  return entries.filter((e) =>
    [e.title, e.summary, e.category, e.tags.join(' '), e.body].join('\n').toLowerCase().includes(needle),
  );
}

function relationsPath(root) {
  return join(root, 'relations.json');
}

async function readRelations(root) {
  return readJson(relationsPath(root), { version: VERSION, edges: [] });
}

/** Record a relation between two entries (idempotent per unordered pair). */
export async function relate(root, from, to, note = '') {
  await ensureLibrary(root);
  if (from === to) throw new Error('cannot relate an entry to itself');
  const a = await getEntry(root, from);
  const b = await getEntry(root, to);
  if (!a) throw new Error(`entry not found: ${from}`);
  if (!b) throw new Error(`entry not found: ${to}`);
  const data = await readRelations(root);
  const exists = data.edges.find(
    (e) => (e.from === from && e.to === to) || (e.from === to && e.to === from),
  );
  if (exists) {
    if (note) exists.note = String(note).trim();
    await writeJson(relationsPath(root), data);
    await reindex(root);
    return { created: false, edge: exists };
  }
  const edge = { from, to, note: String(note || '').trim(), created: nowStamp() };
  data.edges.push(edge);
  await writeJson(relationsPath(root), data);
  await reindex(root);
  return { created: true, edge };
}

export async function listRelations(root) {
  const data = await readRelations(root);
  const entries = await listEntries(root);
  const byId = new Map(entries.map((e) => [e.id, e]));
  return data.edges
    .filter((e) => byId.has(e.from) && byId.has(e.to))
    .map((e) => ({
      ...e,
      fromTitle: byId.get(e.from).title,
      toTitle: byId.get(e.to).title,
    }));
}

function linkOf(entry) {
  const dir = entryDir(entry.type);
  const label = entry.title.replace(/[\[\]]/g, '');
  const meta = [entry.summary, entry.tags.map((t) => `\`#${t}\``).join(' '), entry.created]
    .filter(Boolean)
    .join(' · ');
  return `- [${label}](${dir}/${entry.id}.md)${meta ? ` — ${meta}` : ''}`;
}

function mermaidLabel(title) {
  return title.replace(/"/g, "'");
}
export async function reindex(root) {
  await ensureLibrary(root);
  const meta = await readMeta(root);
  const entries = await listEntries(root);
  const relations = await listRelations(root);
  const order = [...meta.categories, '待归类'];
  const known = new Set(order);
  for (const e of entries) if (!known.has(e.category)) order.push(e.category);

  const lines = [
    '# 认知库',
    '',
    `> ${meta.categories.length} 个分类 · ${entries.filter((e) => e.type === 'article').length} 篇文章 · ` +
      `${entries.filter((e) => e.type === 'card').length} 张卡片 · ${relations.length} 条关联 · 更新于 ${nowStamp()}`,
    '',
  ];
  for (const category of order) {
    const bucket = entries.filter((e) => e.category === category);
    if (!bucket.length) continue;
    lines.push(`## ${category}`, '');
    const articles = bucket.filter((e) => e.type === 'article');
    const cards = bucket.filter((e) => e.type === 'card');
    if (articles.length) lines.push('### 文章', '', ...articles.map(linkOf), '');
    if (cards.length) lines.push('### 卡片', '', ...cards.map(linkOf), '');
  }
  if (!entries.length) lines.push('_还没有内容。_', '');
  await writeFile(join(root, 'index.md'), `${lines.join('\n').trimEnd()}\n`, 'utf8');

  const byId = new Map(entries.map((e) => [e.id, e]));
  // Mermaid ids must be ASCII and unique: CJK strips to the same placeholder otherwise.
  const nodeId = new Map(entries.map((e, index) => [e.id, `n${index}`]));
  const graph = ['# 关系图', '', '```mermaid', 'graph LR'];
  for (const e of entries) graph.push(`  ${nodeId.get(e.id)}["${mermaidLabel(e.title)}"]`);
  for (const r of relations) {
    const a = byId.get(r.from);
    const b = byId.get(r.to);
    if (!a || !b) continue;
    const label = r.note ? `|"${mermaidLabel(r.note)}"|` : '';
    graph.push(`  ${nodeId.get(a.id)} -->${label} ${nodeId.get(b.id)}`);
  }
  graph.push('```', '');
  if (relations.length) {
    graph.push('## 关联列表', '');
    for (const r of relations) {
      graph.push(`- ${byId.get(r.from).title} ↔ ${byId.get(r.to).title}${r.note ? `：${r.note}` : ''}`);
    }
    graph.push('');
  } else {
    graph.push('_还没有关联。用 cognitive_relate 把相互呼应的条目连起来。_', '');
  }
  await writeFile(join(root, 'graph.md'), `${graph.join('\n').trimEnd()}\n`, 'utf8');

  return {
    entries: entries.length,
    articles: entries.filter((e) => e.type === 'article').length,
    cards: entries.filter((e) => e.type === 'card').length,
    relations: relations.length,
    categories: meta.categories,
    index: join(root, 'index.md'),
    graph: join(root, 'graph.md'),
  };
}
