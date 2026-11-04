// TC-11: the KV adapter against the real namespace under a throwaway test prefix.
//   node scripts/kv-store.integration.mjs --prefix test/<run-id>/
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { credentials } from './deployment.mjs';
import { kvStore } from './kv-store.mjs';
import { prefixed } from './store.mjs';

const args = process.argv.slice(2);
const prefix = args[args.indexOf('--prefix') + 1];
if (!/^test\/[a-z0-9][a-z0-9-]{0,39}\/$/.test(prefix ?? '')) { console.error('Refusing: --prefix must match test/<run-id>/'); process.exit(2); }
const store = prefixed(kvStore(credentials()), prefix);
const started = Date.now();
const entries = Array.from({ length: 1500 }, (_, i) => {
  const bytes = i === 0 ? Buffer.alloc(300 * 1024, 65) : Buffer.from(createHash('sha256').update(String(i)).digest('hex').repeat(i % 7 + 1));
  return { key: `kv-it/${String(i).padStart(5, '0')}`, bytes };
});
try {
  const batches = await store.bulkPut(entries);
  console.log(`wrote ${entries.length} keys in ${batches} batch(es)`);
  const listed = await store.list('kv-it/');
  assert.equal(listed.length, 1500, `list returned ${listed.length}`);
  assert.deepEqual(listed.slice().sort(), entries.map(e => e.key).sort());
  console.log('list crossed the 1000-key page boundary');
  let verified = 0;
  for (let i = 0; i < entries.length; i += 50) {
    await Promise.all(entries.slice(i, i + 50).map(async e => { const got = await store.get(e.key, 400 * 1024); assert.ok(got?.equals(e.bytes), `bytes differ for ${e.key}`); verified += 1; }));
  }
  console.log(`read back ${verified} keys byte-identical (including one 300 KiB value)`);
  assert.equal(await store.get('kv-it/does-not-exist', 10), null);
  await store.delete(entries.map(e => e.key));
  const gone = await store.absent(entries.map(e => e.key));
  assert.equal(gone, true, `keys still readable after delete: ${Array.isArray(gone) ? gone.length : 0}`);
  console.log('every key reads back as absent after delete (delete visibility is eventually consistent; polled up to 120 s)');
  console.log(JSON.stringify({ ok: true, prefix, keys: entries.length, seconds: Math.round((Date.now() - started) / 1000) }));
} catch (error) {
  console.error(error.stack ?? String(error));
  try { await store.delete(entries.map(e => e.key)); } catch (e) { console.error(`cleanup failed: ${e.message}`); }
  process.exitCode = 1;
}
