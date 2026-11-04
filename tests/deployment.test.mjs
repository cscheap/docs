// TC-13: publisher guards, workflow shape, store construction and rollback decoupling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { publicationGuard, refreshPublicationHead, credentials, KV_NAMESPACE_ID, R2_BUCKET, SECRET_NAMES } from '../scripts/deployment.mjs';
import { r2Store } from '../scripts/r2-store.mjs';
import { openStores, prefixed, memoryStore } from '../scripts/store.mjs';
import { compile } from '../scripts/compile.mjs';
import { activate, readPointer } from '../scripts/publish-core.mjs';
import { fixtureRepo, intro, cleanup, allObjects, COMMIT } from './helpers.mjs';

const context = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'cscheap/docs' };
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GITHUB_') && !k.startsWith('CSCHEAP_DOCS_') && k !== 'DOCS_PUBLISH_MODE'));
test('publish.mjs refuses local, foreign-repository, PR, tag and non-master execution in both modes before contacting services', () => {
  for (const mode of ['publish', 'rollback']) for (const env of [
    { ...context, GITHUB_ACTIONS: 'false', GITHUB_REF: 'refs/heads/master' },
    { ...context, GITHUB_REPOSITORY: 'other/docs', GITHUB_REF: 'refs/heads/master' },
    ...['refs/heads/preview', 'refs/heads/other', 'refs/tags/master', 'refs/pull/1/merge', 'master', ''].map(GITHUB_REF => ({ ...context, GITHUB_REF })),
  ]) {
    const run = spawnSync(process.execPath, ['scripts/publish.mjs'], { env: { ...clean, ...env, DOCS_PUBLISH_MODE: mode }, encoding: 'utf8' });
    assert.equal(run.status, 1, JSON.stringify(env)); assert.match(run.stderr, /serialized master workflow/);
  }
  assert.deepEqual(publicationGuard({ ...context, GITHUB_REF: 'refs/heads/master', CSCHEAP_DOCS_ENVIRONMENT: 'x' }), { branch: 'master' });
});
test('stores are built from explicit configuration and never read GITHUB_*', () => {
  const store = r2Store({ accountId: 'a'.repeat(32), apiToken: 't', bucket: R2_BUCKET });
  assert.equal(store.kind, 'r2');
  assert.throws(() => r2Store({ accountId: 'a'.repeat(32), apiToken: 't', bucket: 'Bad Bucket' }), /bucket/);
  const stores = openStores({ accountId: 'a'.repeat(32), apiToken: 't', namespaceId: KV_NAMESPACE_ID, bucket: R2_BUCKET, prefix: 'test/x/' });
  assert.equal(stores.kv.kind, 'kv'); stores.close();
  assert.deepEqual(credentials({ CSCHEAP_DOCS_CF_ACCOUNT_ID: 'c'.repeat(32), CSCHEAP_DOCS_CF_API_TOKEN: 'tok' }), { accountId: 'c'.repeat(32), apiToken: 'tok', namespaceId: KV_NAMESPACE_ID, bucket: R2_BUCKET });
  assert.throws(() => credentials({}), /Missing CSCHEAP_DOCS_CF_ACCOUNT_ID/);
  assert.deepEqual(SECRET_NAMES, ['CSCHEAP_DOCS_CF_ACCOUNT_ID', 'CSCHEAP_DOCS_CF_API_TOKEN']);
});
test('prefixed store applies the prefix to every operation and strips it from list()', async () => {
  const inner = memoryStore('kv'), p = prefixed(inner, 'test/run/');
  await p.put('docs/channels/preview.json', Buffer.from('a')); await p.bulkPut([{ key: 'docs/objects/1.json', bytes: Buffer.from('b') }]);
  assert.deepEqual([...inner.objects.keys()].sort(), ['test/run/docs/channels/preview.json', 'test/run/docs/objects/1.json']);
  assert.deepEqual(await p.list('docs/'), ['docs/channels/preview.json', 'docs/objects/1.json']);
  assert.equal((await p.get('docs/objects/1.json', 10)).toString(), 'b');
  await p.delete(['docs/objects/1.json']); assert.deepEqual(await p.list(''), ['docs/channels/preview.json']);
});
test('fresh head follows the remote master branch', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'docs-branches-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--bare', 'origin.git'); git('init', '-b', 'master', 'source');
  const source = (...args) => git('-C', 'source', ...args);
  source('config', 'user.name', 'Docs test'); source('config', 'user.email', 'docs-test@example.invalid');
  source('commit', '--allow-empty', '-m', 'base'); source('remote', 'add', 'origin', '../origin.git'); source('push', 'origin', 'master');
  git('clone', '--single-branch', '--branch', 'master', 'origin.git', 'runner');
  const runner = join(cwd, 'runner');
  assert.equal(refreshPublicationHead('master', runner), source('rev-parse', 'HEAD'));
  source('commit', '--allow-empty', '-m', 'two'); source('push', 'origin', 'master');
  assert.equal(refreshPublicationHead('master', runner), source('rev-parse', 'HEAD'));
  assert.throws(() => refreshPublicationHead('preview', runner), /Invalid publication branch/);
});
test('workflow: master-only publish, PR validates only, rollback job is independent of validate and never builds content', () => {
  const workflow = parse(readFileSync('.github/workflows/docs.yml', 'utf8'));
  assert.deepEqual(workflow.on.push.branches, ['master']);
  assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs), ['mode', 'channel', 'release']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.ok(!/R2_|S3_|BUCKET|bucket/.test(JSON.stringify(workflow)), 'no bucket or S3 configuration in the workflow'); assert.ok(!JSON.stringify(workflow.on.push).includes('preview')); assert.equal(workflow.on.pull_request, null);
  assert.ok(!JSON.stringify(workflow.jobs.validate).includes('secrets.')); assert.ok(!JSON.stringify(workflow).includes('vars.'));
  const activate = workflow.jobs.activate, rollback = workflow.jobs.rollback;
  assert.equal(activate.needs, 'validate'); assert.equal(rollback.needs, undefined);
  assert.equal(activate.if, "github.event_name == 'push' && github.ref == 'refs/heads/master'");
  assert.equal(rollback.if, "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/master'");
  for (const job of [activate, rollback]) {
    for (const name of SECRET_NAMES) assert.equal(job.env[name], '${{ secrets.' + name + ' }}');
    assert.equal(job.concurrency.group, 'cscheap-docs-activation'); assert.equal(job.concurrency['cancel-in-progress'], false);
    assert.deepEqual(job.permissions, { contents: 'read' });
  }
  assert.ok(JSON.stringify(activate.steps).includes('docs:build')); assert.ok(!JSON.stringify(rollback.steps).includes('docs:build')); assert.ok(!JSON.stringify(rollback.steps).includes('npm run check'));
  assert.equal(rollback.env.DOCS_PUBLISH_MODE, 'rollback'); assert.equal(rollback.env.DOCS_ROLLBACK_CHANNEL, '${{ inputs.channel }}');
});

test('rollback is decoupled from the current content: a release activated earlier can be restored while the working tree no longer compiles', async t => {
  const good = await fixtureRepo({ units: [intro(), { slug: 'g/a' }] }); t.after(() => cleanup(good));
  const r1 = await compile({ root: good, docsCommit: '1'.repeat(40) });
  const r2 = await compile({ root: good, docsCommit: '2'.repeat(40) });
  const s = { kv: memoryStore('kv'), r2: memoryStore('r2') };
  const publish = r => activate({ ...s, channel: 'preview', mode: 'publish', manifestBytes: r.channels.preview.manifestBytes, objects: allObjects(r), assetBytes: r.assetBytes, head: async () => r.channels.preview.manifest.docsCommit, isAncestor: async () => true, sleep: async () => {} });
  assert.equal((await publish(r1)).status, 'published'); assert.equal((await publish(r2)).status, 'published');
  const broken = await fixtureRepo({ units: [intro({ en: { body: '## H\n\n[x](/docs/nowhere)\n' } })] }); t.after(() => cleanup(broken));
  await assert.rejects(compile({ root: broken, docsCommit: '3'.repeat(40) }), /Broken link/, 'current content does not build');
  const back = await activate({ ...s, channel: 'preview', mode: 'rollback', releaseId: r1.channels.preview.releaseId, head: async () => { throw new Error('rollback must not consult the branch head'); }, isAncestor: async () => { throw new Error('rollback must not check ancestry'); }, sleep: async () => {} });
  assert.equal(back.status, 'rolled-back');
  assert.equal((await readPointer(s.kv, 'preview')).pointer.current.releaseId, r1.channels.preview.releaseId);
});
