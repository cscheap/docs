// TC-07: size limits per object type on the real corpus plus synthetic over-limit fixtures; determinism.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../scripts/compile.mjs';
import { LIMITS } from '../contracts/schema.ts';
import { fixtureRepo, intro, cleanup, COMMIT, REPO } from './helpers.mjs';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

test('TC-07 real corpus: pages ≤ 256 KiB, search indices ≤ 1 MiB, manifests ≤ 1 MiB, and two builds are byte-identical', async () => {
  const [a, b] = [await compile({ root: REPO }), await compile({ root: REPO })];
  for (const channel of ['preview', 'production']) {
    const c = a.channels[channel];
    assert.ok(c.manifestBytes.length <= LIMITS.manifest, `manifest ${c.manifestBytes.length}`);
    for (const p of c.manifest.pages) { const bytes = c.objects.get(p.object.sha256); assert.equal(bytes.length, p.object.size); assert.ok(bytes.length <= LIMITS.page, `${p.locale}/${p.slug}`); }
    for (const ref of Object.values(c.manifest.search)) { const bytes = c.objects.get(ref.sha256); assert.equal(bytes.length, ref.size); assert.ok(bytes.length <= LIMITS.search); }
    assert.ok(c.manifestBytes.equals(b.channels[channel].manifestBytes), `${channel} deterministic`);
    assert.deepEqual([...c.objects.keys()].sort(), [...b.channels[channel].objects.keys()].sort());
    assert.equal(c.manifest.pages.length, a.units.length * 3);
  }
  assert.equal(a.warnings.length, 0);
});
test('TC-07 oversized pages are rejected: a 300 KiB source file and a page whose compiled object exceeds 256 KiB', async t => {
  const root = await fixtureRepo({ units: [intro(), { slug: 'big/page', en: { body: `## Big\n\n${'word '.repeat(60 * 1024)}\n` } }] }); t.after(() => cleanup(root));
  await assert.rejects(compile({ root, docsCommit: COMMIT }), /Oversized input/);
  const json = JSON.stringify(Object.fromEntries(Array.from({ length: 6000 }, (_, i) => [`key_${i}`, i])), null, 2);
  const expanded = await fixtureRepo({ units: [intro(), { slug: 'big/code', en: { body: `## Code\n\n\`\`\`json\n${json}\n\`\`\`\n` } }] }); t.after(() => cleanup(expanded));
  assert.ok(json.length < LIMITS.page, 'source stays under the input limit');
  await assert.rejects(compile({ root: expanded, docsCommit: COMMIT }), /Page en\/big\/code exceeds byte limit/);
});
test('TC-07 a search index over 1 MiB is rejected', async t => {
  const units = [intro(), ...Array.from({ length: 30 }, (_, i) => ({ slug: `s/p${i}`, en: { body: `## P${i}\n\n${'text '.repeat(8000)}\n` } }))];
  const root = await fixtureRepo({ units }); t.after(() => cleanup(root));
  await assert.rejects(compile({ root, docsCommit: COMMIT }), /Search index en exceeds byte limit/);
});
test('TC-07 a manifest over 1 MiB is rejected and nothing is emitted for that channel', async t => {
  const units = [intro(), ...Array.from({ length: 1500 }, (_, i) => ({ slug: `m/p${String(i).padStart(4, '0')}`, en: { title: `T${i} ${'t'.repeat(190)}`, description: `D${i} ${'d'.repeat(390)}`, body: `## H\n\nx\n` } }))];
  const root = await fixtureRepo({ units }); t.after(() => cleanup(root));
  await assert.rejects(compile({ root, docsCommit: COMMIT, channels: ['production'] }), /Manifest production exceeds byte limit/);
});

test('TC-07 a failed build leaves no channel artefacts: stale dist/ is removed before compiling', async t => {
  const root = await fixtureRepo({ units: [intro(), { slug: 'big/page', en: { body: `## Big\n\n${'word '.repeat(60 * 1024)}\n` } }] }); t.after(() => cleanup(root));
  await mkdir(join(root, 'dist/production'), { recursive: true }); await writeFile(join(root, 'dist/production/manifest.json'), '{"stale":true}'); await writeFile(join(root, 'dist/build.json'), '{}');
  const run = spawnSync(process.execPath, [join(REPO, 'scripts/build.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 1); assert.match(run.stderr, /Oversized input/);
  await assert.rejects(access(join(root, 'dist')), /ENOENT/, 'dist/ must not exist after a failed build');
});
