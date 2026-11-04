// Shared serialization for content units: the API reference generator, the one-off migration and
// any agent tooling must write byte-identical files, otherwise `api:check` reports spurious drift.
import { createHash } from 'node:crypto';
import { Item, LocaleFrontmatter } from '../contracts/schema.ts';

export const LOCALE_FILES = Object.freeze({ en: 'en.mdx', 'zh-CN': 'zh-CN.mdx', ru: 'ru.mdx' });
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const sourceDigestOf = englishText => `sha256:${digest(englishText)}`;

/** Fixed key order, two-space indent, trailing newline. */
const ITEM_KEYS = ['schemaVersion', 'docId', 'slug', 'kind', 'stage', 'deprecated', 'sources', 'generated', 'workflow'];
const WORKFLOW_KEYS = ['stage', 'by', 'at', 'note'];
export function serializeItem(item) {
  const parsed = Item.parse(item);
  const ordered = {};
  for (const key of ITEM_KEYS) if (parsed[key] !== undefined) ordered[key] = parsed[key];
  ordered.workflow = parsed.workflow.map(entry => {
    const out = {};
    for (const key of WORKFLOW_KEYS) if (entry[key] !== undefined) out[key] = entry[key];
    return out;
  });
  return JSON.stringify(ordered, null, 2) + '\n';
}

/** Frontmatter is JSON-quoted YAML scalars in a fixed order; body follows one blank line. */
export function serializeLocaleFile(meta, body) {
  const parsed = LocaleFrontmatter.parse(meta);
  const lines = ['title', 'description', 'sourceDigest'].filter(k => parsed[k] !== undefined).map(k => `${k}: ${JSON.stringify(parsed[k])}`);
  if (body.includes('\r')) throw new Error('Bodies must use LF line endings');
  return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '').replace(/\n*$/, '\n')}`;
}

export function splitFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('Missing frontmatter');
  return { yaml: match[1], body: match[2] };
}
