// Local acceptance of the activation protocol against the real KV namespace and R2 bucket.
// Everything is written under a mandatory `test/<run-id>/` prefix and deleted afterwards. This is
// not a publishing tool: it never touches `docs/…` keys, never reads GITHUB_* and refuses to run
// without DOCS_ALLOW_LOCAL_PUBLISH=1.
//   DOCS_ALLOW_LOCAL_PUBLISH=1 node scripts/publish-local-test.mjs --prefix test/<run-id>/
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { credentials } from './deployment.mjs';
import { openStores } from './store.mjs';
import { activate, readPointer, readMarker } from './publish-core.mjs';
import { compile } from './compile.mjs';
import { KEYS } from '../contracts/schema.ts';

const args = process.argv.slice(2);
const prefix = args[args.indexOf('--prefix') + 1];
if (process.env.DOCS_ALLOW_LOCAL_PUBLISH !== '1') { console.error('Refusing: DOCS_ALLOW_LOCAL_PUBLISH=1 is required'); process.exit(2); }
if (!/^test\/[a-z0-9][a-z0-9-]{0,39}\/$/.test(prefix ?? '')) { console.error('Refusing: --prefix must match test/<run-id>/'); process.exit(2); }
let creds; try { creds = credentials(); } catch (error) { console.error(`Refusing: ${error.message}`); process.exit(2); }

const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const stores = openStores({ ...creds, prefix });
const written = new Set();
for (const store of [stores.kv]) {
  const put = store.put, bulkPut = store.bulkPut;
  store.put = (key, ...rest) => { written.add(key); return put(key, ...rest); };
  store.bulkPut = entries => { for (const e of entries) written.add(e.key); return bulkPut(entries); };
}
const workspace = await mkdtemp(join(tmpdir(), 'docs-local-publish-'));
const log = message => console.log(`[local-test] ${message}`);
async function cleanup() {
  const kvKeys = new Set([...written, ...await stores.kv.list('')]);
  if (kvKeys.size) await stores.kv.delete([...kvKeys]);
  const r2Keys = await stores.r2.list(''); if (r2Keys.length) await stores.r2.delete(r2Keys);
  const gone = await stores.kv.absent([...kvKeys]);
  assert.equal(gone, true, `KV keys still readable after delete: ${Array.isArray(gone) ? gone.join(', ') : ''}`);
  for (const key of r2Keys) assert.equal(await stores.r2.get(key, 1), null, `R2 key still readable: ${key}`);
  log(`cleanup complete: ${kvKeys.size} KV keys and ${r2Keys.length} R2 keys deleted and confirmed absent (KV deletes are eventually consistent; polled)`);
}
try {
  // Fixture workspace = the real repository minus most units, so the run stays small.
  await cp('tests/fixtures/minimal', workspace, { recursive: true });
  const build = async () => {
    const result = await compile({ root: workspace, docsCommit: head });
    const objects = new Map(); for (const c of Object.values(result.channels)) for (const [sha, bytes] of c.objects) objects.set(sha, bytes);
    return { result, objects };
  };
  const run = async (channel, mode, extra = {}) => activate({ ...stores, channel, mode, head: async () => head, isAncestor: async () => true, log, ...extra });
  const a = await build();
  const rA = await run('preview', 'publish', { manifestBytes: a.result.channels.preview.manifestBytes, objects: a.objects, assetBytes: a.result.assetBytes });
  assert.equal(rA.status, 'published', JSON.stringify(rA));
  log(`version A published: ${rA.releaseId.slice(0, 12)}`);
  // Version B: change one page (first-steps: its stale zh-CN translation then falls back to English,
  // which exercises the per-channel link resolution without touching the introduction anchors).
  const page = join(workspace, 'content/guides/first-steps/en.mdx');
  await writeFile(page, (await readFile(page, 'utf8')) + '\nLocal acceptance paragraph.\n');
  const b = await build();
  const rB = await run('preview', 'publish', { manifestBytes: b.result.channels.preview.manifestBytes, objects: b.objects, assetBytes: b.result.assetBytes });
  assert.equal(rB.status, 'published'); assert.notEqual(rB.releaseId, rA.releaseId);
  let { pointer } = await readPointer(stores.kv, 'preview');
  assert.equal(pointer.current.releaseId, rB.releaseId); assert.equal(pointer.previous.releaseId, rA.releaseId);
  for (const id of [rA.releaseId, rB.releaseId]) assert.ok(await readMarker(stores.kv, id), 'marker exists');
  log(`version B published: ${rB.releaseId.slice(0, 12)}, previous = A`);
  const back = await run('preview', 'rollback', { releaseId: rA.releaseId });
  assert.equal(back.status, 'rolled-back');
  ({ pointer } = await readPointer(stores.kv, 'preview'));
  assert.equal(pointer.current.releaseId, rA.releaseId); assert.equal(pointer.previous.releaseId, rB.releaseId);
  log('rolled back to A');
  const again = await run('preview', 'publish', { manifestBytes: a.result.channels.preview.manifestBytes, objects: a.objects, assetBytes: a.result.assetBytes });
  assert.equal(again.status, 'already-current');
  log('rerun of A is already-current');
  const objectKeys = await stores.kv.list(KEYS.objectsPrefix);
  assert.ok(objectKeys.length >= a.result.channels.preview.manifest.pages.length + 3, 'objects present');
  const assetKeys = await stores.r2.list('assets/');
  assert.equal(assetKeys.length, a.result.assetBytes.size, 'assets present');
  log(`verified ${objectKeys.length} objects and ${assetKeys.length} assets under ${prefix}`);
  await cleanup();
  console.log(JSON.stringify({ ok: true, prefix, versionA: rA.releaseId, versionB: rB.releaseId }));
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  try { await cleanup(); } catch (cleanupError) { console.error(`cleanup failed: ${cleanupError.message}`); }
  process.exitCode = 1;
} finally { stores.close(); await rm(workspace, { recursive: true, force: true }); }
