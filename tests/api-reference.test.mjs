// TC-14: generator ownership of unit fields, determinism and reaction to OpenAPI changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, rm, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { serializeItem } from '../scripts/unit.mjs';
import { REPO } from './helpers.mjs';

const script = join(REPO, 'scripts/api-reference.mjs');
async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'docs-apiref-'));
  for (const entry of ['openapi', 'baselines', 'assets']) await cp(join(REPO, entry), join(dir, entry), { recursive: true });
  await mkdir(join(dir, 'content/api'), { recursive: true });
  await cp(join(REPO, 'content/api/reference'), join(dir, 'content/api/reference'), { recursive: true });
  return dir;
}
const generate = (cwd, ...flags) => spawnSync(process.execPath, [script, '--from-openapi', ...flags], { cwd, encoding: 'utf8' });
async function tree(dir, prefix = '') {
  const out = {};
  for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const p = join(dir, e.name); if (e.isDirectory()) Object.assign(out, await tree(p, `${prefix}${e.name}/`)); else out[`${prefix}${e.name}`] = createHash('sha256').update(await readFile(p)).digest('hex');
  }
  return out;
}
test('TC-14 regenerating twice produces no change; --check passes; flow fields of an existing unit survive regeneration', async t => {
  const dir = await workspace(); t.after(() => rm(dir, { recursive: true, force: true }));
  const unit = join(dir, 'content/api/reference/account/get-account');
  const item = JSON.parse(await readFile(join(unit, 'item.json'), 'utf8'));
  item.stage = 'held'; item.deprecated = true;
  item.workflow = [{ stage: 'published', by: 'claude-code', at: '2026-11-04T08:00:00Z' }, { stage: 'held', by: 'human', at: '2026-11-05T00:00:00Z', note: 'wording review' }];
  await writeFile(join(unit, 'item.json'), serializeItem(item));
  const first = generate(dir); assert.equal(first.status, 0, first.stderr);
  const after1 = await tree(join(dir, 'content'));
  const second = generate(dir); assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(await tree(join(dir, 'content')), after1, 'second generation is a no-op');
  const check = generate(dir, '--check'); assert.equal(check.status, 0, check.stderr);
  const kept = JSON.parse(await readFile(join(unit, 'item.json'), 'utf8'));
  assert.equal(kept.stage, 'held'); assert.equal(kept.deprecated, true); assert.deepEqual(kept.workflow, item.workflow);
  const other = join(dir, 'content/api/reference/account/get-account'); // explicit false must survive too
  const explicitFalse = JSON.parse(await readFile(join(other, 'item.json'), 'utf8')); explicitFalse.deprecated = false; await writeFile(join(other, 'item.json'), serializeItem(explicitFalse));
  assert.equal(generate(dir).status, 0);
  assert.equal(JSON.parse(await readFile(join(other, 'item.json'), 'utf8')).deprecated, false, 'explicit deprecated:false is preserved');
  assert.deepEqual({ docId: kept.docId, slug: kept.slug, kind: kept.kind, sources: kept.sources, generated: kept.generated }, { docId: 'api.reference.account.get-account', slug: 'api/reference/account/get-account', kind: 'reference', sources: ['api'], generated: true });
});
test('TC-14 a new unit starts as draft with the API baseline date; --check reports a missing unit', async t => {
  const dir = await workspace(); t.after(() => rm(dir, { recursive: true, force: true }));
  const unit = join(dir, 'content/api/reference/platform/get-health');
  await rm(unit, { recursive: true, force: true });
  const check = generate(dir, '--check'); assert.equal(check.status, 1); assert.match(check.stderr, /Generated unit missing/);
  const run = generate(dir); assert.equal(run.status, 0, run.stderr);
  const item = JSON.parse(await readFile(join(unit, 'item.json'), 'utf8'));
  assert.equal(item.stage, 'draft');
  assert.deepEqual(item.workflow, [{ stage: 'draft', by: 'claude-code', at: '2026-10-26T00:00:00Z', note: 'generated from api baseline 75610b54a1d5' }]);
  assert.equal(generate(dir).status, 0);
  assert.deepEqual(JSON.parse(await readFile(join(unit, 'item.json'), 'utf8')), item, 'deterministic on rerun');
});
test('TC-14 an OpenAPI description change updates the three locale files and translation digests but not the flow fields', async t => {
  const dir = await workspace(); t.after(() => rm(dir, { recursive: true, force: true }));
  const unit = join(dir, 'content/api/reference/platform/get-health');
  const before = { item: await readFile(join(unit, 'item.json'), 'utf8'), en: await readFile(join(unit, 'en.mdx'), 'utf8'), zh: await readFile(join(unit, 'zh-CN.mdx'), 'utf8'), ru: await readFile(join(unit, 'ru.mdx'), 'utf8') };
  for (const locale of ['en', 'zh-CN', 'ru']) {
    const path = join(dir, `openapi/${locale}.json`); const schema = JSON.parse(await readFile(path, 'utf8'));
    schema.paths['/health'].get.description += ' Changed for the test.';
    const bytes = JSON.stringify(schema, null, 2) + '\n'; await writeFile(path, bytes);
    const provenance = JSON.parse(await readFile(join(dir, 'openapi/provenance.json'), 'utf8'));
    provenance.files[locale] = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(dir, 'openapi/provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  }
  const run = generate(dir); assert.equal(run.status, 0, run.stderr);
  assert.equal(await readFile(join(unit, 'item.json'), 'utf8'), before.item, 'flow fields untouched');
  const en = await readFile(join(unit, 'en.mdx'), 'utf8'), zh = await readFile(join(unit, 'zh-CN.mdx'), 'utf8'), ru = await readFile(join(unit, 'ru.mdx'), 'utf8');
  assert.notEqual(en, before.en); assert.match(en, /Changed for the test/);
  const digest = `sha256:${createHash('sha256').update(en).digest('hex')}`;
  for (const text of [zh, ru]) assert.match(text, new RegExp(`sourceDigest: "${digest}"`));
  assert.notEqual(zh, before.zh); assert.notEqual(ru, before.ru);
  assert.equal(await readFile(join(dir, 'assets/openapi-en.json'), 'utf8'), await readFile(join(dir, 'openapi/en.json'), 'utf8'), 'published OpenAPI asset follows the source');
});
