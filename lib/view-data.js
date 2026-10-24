/**
 * View model for the Cognitive Library UI.
 *
 * Kept host-side and pure so the HTTP route stays a thin wrapper and the shape
 * can be tested without a browser.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listEntries, listCategories } from './store.js';

function relativeFile(entry) {
  return `${entry.type === 'article' ? 'articles' : 'cards'}/${entry.id}.md`;
}

/** Build the payload the client panel renders: categories plus entry metadata. */
export async function buildViewData(root) {
  const [categories, entries] = await Promise.all([listCategories(root), listEntries(root)]);
  return {
    generated: new Date().toISOString(),
    categories,
    entries: entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      title: entry.title,
      category: entry.category,
      summary: entry.summary,
      tags: entry.tags,
      created: entry.created,
      file: relativeFile(entry),
    })),
  };
}

/**
 * Read one entry body by id.
 * The id is matched against the index first, so a request can never escape the root.
 */
export async function readEntry(root, id) {
  const entries = await listEntries(root);
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) return null;
  const content = await readFile(join(root, relativeFile(entry)), 'utf8');
  return { id: entry.id, title: entry.title, type: entry.type, content };
}
