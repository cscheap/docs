// Test helpers: build a throwaway v3 repository (baselines copied from the real ones) from a compact
// unit description, so every test states exactly the content it depends on.
import { mkdtemp, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serializeItem, serializeLocaleFile, sourceDigestOf, LOCALE_FILES } from '../scripts/unit.mjs';

export const REPO = resolve(import.meta.dirname, '..');
export const COMMIT = '1'.repeat(40);
export const AT = '2026-11-04T00:00:00Z';
export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/**
 * unit = { slug, docId?, kind?, stage?, deprecated?, sources?, generated?, workflow?,
 *          en: { title?, description?, body }, 'zh-CN'?: {...}, ru?: {...}, staleDigest?: ['zh-CN'] }
 * Translations get a fresh sourceDigest unless listed in staleDigest.
 */
export function unitFiles(unit) {
  const stage = unit.stage ?? 'published';
  const item = {
    schemaVersion: 3, docId: unit.docId ?? unit.slug.replaceAll('/', '.'), slug: unit.slug, kind: unit.kind ?? 'explanation', stage,
    ...(unit.deprecated ? { deprecated: true } : {}), sources: unit.sources ?? ['api'], ...(unit.generated ? { generated: true } : {}),
    workflow: unit.workflow ?? [{ stage, by: 'claude-code', at: AT }],
  };
  const files = { 'item.json': unit.rawItem ?? serializeItem(item) };
  const en = unit.en ?? { body: `## Heading\n\nBody of ${unit.slug}.\n` };
  const enText = serializeLocaleFile({ title: en.title ?? `Title ${unit.slug}`, description: en.description ?? `Description ${unit.slug}` }, en.body);
  files[LOCALE_FILES.en] = enText;
  for (const locale of ['zh-CN', 'ru']) {
    const t = unit[locale]; if (!t) continue;
    const stale = unit.staleDigest?.includes(locale);
    files[LOCALE_FILES[locale]] = serializeLocaleFile({ title: t.title ?? `${locale} ${unit.slug}`, description: t.description ?? `${locale} description`, sourceDigest: stale ? sourceDigestOf('stale') : sourceDigestOf(enText) }, t.body ?? en.body);
  }
  return files;
}
export async function writeUnit(root, unit) {
  const dir = join(root, 'content', unit.slug);
  await mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(unitFiles(unit))) await writeFile(join(dir, name), text);
  return dir;
}
export const intro = (extra = {}) => ({ slug: 'get-started/introduction', en: { title: 'Introduction', description: 'Intro', body: '## Welcome\n\nIntro body.\n' }, ...extra });
export async function fixtureRepo({ units, navigation, redirects = [], assets = {}, dir } = {}) {
  const root = dir ?? await mkdtemp(join(tmpdir(), 'docs-v3-'));
  await cp(join(REPO, 'baselines'), join(root, 'baselines'), { recursive: true });
  await mkdir(join(root, 'assets'), { recursive: true });
  for (const [name, bytes] of Object.entries(assets)) await writeFile(join(root, 'assets', name), bytes);
  await mkdir(join(root, 'content'), { recursive: true });
  for (const unit of units) await writeUnit(root, unit);
  const nav = navigation ?? { schemaVersion: 1, groups: [{ title: { en: 'All', 'zh-CN': '全部', ru: 'Все' }, pages: units.map(u => u.slug) }] };
  await writeFile(join(root, 'navigation.json'), JSON.stringify(nav, null, 2) + '\n');
  await writeFile(join(root, 'redirects.json'), JSON.stringify(redirects, null, 2) + '\n');
  return root;
}
export const cleanup = root => rm(root, { recursive: true, force: true });
/** Collect every object of every channel into one map (sha256 → bytes). */
export function allObjects(result) {
  const objects = new Map();
  for (const c of Object.values(result.channels)) for (const [sha, bytes] of c.objects) objects.set(sha, bytes);
  return objects;
}
