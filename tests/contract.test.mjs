// TC-05: malformed units and navigation references fail the build; channel-filtered navigation entries are skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { compile } from '../scripts/compile.mjs';
import { fixtureRepo, intro, cleanup, COMMIT, AT } from './helpers.mjs';

const item = (overrides = {}) => JSON.stringify({ schemaVersion: 3, docId: 'u.bad', slug: 'u/bad', kind: 'how-to', stage: 'published', sources: ['api'], workflow: [{ stage: 'published', by: 'claude-code', at: AT }], ...overrides }) + '\n';
const rejects = async (t, rawItem, pattern, extra = {}) => {
  const root = await fixtureRepo({ units: [intro(), { slug: 'u/bad', rawItem, ...extra }] }); t.after(() => cleanup(root));
  await assert.rejects(compile({ root, docsCommit: COMMIT }), pattern);
};
test('TC-05 workflow and identity rules are enforced', async t => {
  await rejects(t, item({ workflow: [] }), /Invalid item.json in u\/bad/);
  await rejects(t, item({ workflow: [{ stage: 'reviewed', by: 'claude-code', at: AT }] }), /Last workflow entry must match stage/);
  await rejects(t, item({ workflow: [{ stage: 'published', by: 'someone', at: AT }] }), /Invalid item.json/);
  await rejects(t, item({ workflow: [{ stage: 'published', by: 'human', at: '2026-11-04 00:00' }] }), /Invalid item.json/);
  await rejects(t, item({ workflow: [{ stage: 'draft', by: 'grok', at: '2026-11-04T10:00:00Z' }, { stage: 'published', by: 'claude', at: '2026-11-04T09:00:00Z' }] }), /timestamps must not decrease/);
  for (const at of ['2026-02-30T00:00:00Z', '2026-11-04T24:00:00Z', '2026-13-01T00:00:00Z', '2026-11-04T23:60:00Z', '2026-11-04T23:00:00+08:00', '2025-02-29T00:00:00Z']) await rejects(t, item({ workflow: [{ stage: 'published', by: 'human', at }] }), /Invalid RFC 3339/, at);
  const leap = await fixtureRepo({ units: [intro(), { slug: 'u/leap', workflow: [{ stage: 'published', by: 'human', at: '2024-02-29T23:59:59.999Z' }] }] }); t.after(() => cleanup(leap));
  assert.ok(await compile({ root: leap, docsCommit: COMMIT }), 'a real leap day is accepted');
  await rejects(t, item({ slug: 'u/elsewhere' }), /Slug\/directory mismatch: u\/bad/);
  await rejects(t, item({ unexpected: true }), /Invalid item.json/);
});
test('TC-05 missing English, English with provenance, duplicate docId', async t => {
  const root = await fixtureRepo({ units: [intro(), { slug: 'u/bad' }] }); t.after(() => cleanup(root));
  await rm(join(root, 'content/u/bad/en.mdx'));
  await assert.rejects(compile({ root, docsCommit: COMMIT }), /Missing en.mdx: u\/bad/);
  const provenance = await fixtureRepo({ units: [intro()] }); t.after(() => cleanup(provenance));
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(provenance, 'content/get-started/introduction/en.mdx'), '---\ntitle: "x"\ndescription: "y"\nsourceDigest: "sha256:' + 'a'.repeat(64) + '"\n---\n\n## H\n\nbody\n');
  await assert.rejects(compile({ root: provenance, docsCommit: COMMIT }), /English cannot carry sourceDigest/);
  await rejects(t, item({ docId: 'get-started.introduction' }), /Duplicate docId/);
});
test('TC-05 navigation: references to unknown slugs fail, units outside navigation fail, channel-filtered entries are skipped silently', async t => {
  const dangling = await fixtureRepo({ units: [intro()], navigation: { schemaVersion: 1, groups: [{ title: { en: 'A', 'zh-CN': 'A', ru: 'A' }, pages: ['get-started/introduction', 'u/missing'] }] } });
  t.after(() => cleanup(dangling));
  await assert.rejects(compile({ root: dangling, docsCommit: COMMIT }), /Dangling navigation: u\/missing/);
  const outside = await fixtureRepo({ units: [intro(), { slug: 'u/orphan' }], navigation: { schemaVersion: 1, groups: [{ title: { en: 'A', 'zh-CN': 'A', ru: 'A' }, pages: ['get-started/introduction'] }] } });
  t.after(() => cleanup(outside));
  await assert.rejects(compile({ root: outside, docsCommit: COMMIT }), /Unit missing from navigation: u\/orphan/);
  const filtered = await fixtureRepo({ units: [intro(), { slug: 'u/reviewed', stage: 'reviewed' }, { slug: 'u/draft', stage: 'draft' }] }); t.after(() => cleanup(filtered));
  const result = await compile({ root: filtered, docsCommit: COMMIT });
  const names = c => c.manifest.trees.en.flatMap(g => g.children.map(p => p.key));
  assert.deepEqual(names(result.channels.preview), ['en:get-started/introduction', 'en:u/reviewed']);
  assert.deepEqual(names(result.channels.production), ['en:get-started/introduction']);
});
