// TC-10: KV adapter boundaries with a mocked fetch and a fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kvStore, KV_LIMITS } from '../scripts/kv-store.mjs';
import { cloudflareApi } from '../scripts/cf-api.mjs';
import { compile } from '../scripts/compile.mjs';
import { activate, readMarker, POINTER_PUT_ATTEMPTS } from '../scripts/publish-core.mjs';
import { memoryStore } from '../scripts/store.mjs';
import { KEYS } from '../contracts/schema.ts';
import { fixtureRepo, intro, cleanup, allObjects } from './helpers.mjs';

const ACCOUNT = 'a'.repeat(32), NS = 'b'.repeat(32);
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
function harness(handler) {
  const calls = []; let clock = 0; const sleeps = [];
  const fetch = async (url, init) => { calls.push({ url: String(url), method: init.method, body: init.body, headers: init.headers }); return handler(calls.at(-1), calls.length); };
  const sleep = async ms => { sleeps.push(ms); clock += ms; };
  const store = kvStore({ accountId: ACCOUNT, apiToken: 't', namespaceId: NS, fetch, sleep });
  return { store, calls, sleeps, now: () => clock };
}
test('list follows cursors across three pages', async () => {
  const pages = [{ result: [{ name: 'docs/objects/1' }], result_info: { cursor: 'c1' } }, { result: [{ name: 'docs/objects/2' }], result_info: { cursor: 'c2' } }, { result: [{ name: 'docs/objects/3' }], result_info: { cursor: '' } }];
  const h = harness(call => json({ success: true, ...pages[call.url.includes('cursor=c2') ? 2 : call.url.includes('cursor=c1') ? 1 : 0] }));
  assert.deepEqual(await h.store.list('docs/objects/'), ['docs/objects/1', 'docs/objects/2', 'docs/objects/3']);
  assert.equal(h.calls.length, 3); assert.ok(h.calls[0].url.includes('limit=1000'));
});
test('bulkPut splits by pair count and by serialized byte size', async () => {
  const h = harness(() => json({ success: true, result: { successful_key_count: 1, unsuccessful_keys: [] } }));
  const many = Array.from({ length: KV_LIMITS.bulkPairs + 1 }, (_, i) => ({ key: `k${i}`, bytes: Buffer.from('x') }));
  assert.equal(await h.store.bulkPut(many), 2);
  assert.equal(JSON.parse(h.calls[0].body).length, KV_LIMITS.bulkPairs); assert.equal(JSON.parse(h.calls[1].body).length, 1);
  const big = Array.from({ length: 4 }, (_, i) => ({ key: `b${i}`, bytes: Buffer.alloc(24 * 1024 * 1024, 65) }));
  h.calls.length = 0;
  assert.equal(await h.store.bulkPut(big), 2, '4 × 24 MiB base64 ≈ 128 MB → two batches under 90 MB');
  for (const call of h.calls) assert.ok(Buffer.byteLength(call.body) <= KV_LIMITS.bulkBytes + 1024);
});
test('unsuccessful_keys are retried alone, then the write fails after three retries', async () => {
  let attempts = 0;
  const h = harness(call => { attempts += 1; const keys = JSON.parse(call.body).map(e => e.key); return json({ success: true, result: { successful_key_count: keys.length - 1, unsuccessful_keys: attempts < 3 ? [keys.at(-1)] : [] } }); });
  await h.store.bulkPut([{ key: 'a', bytes: Buffer.from('1') }, { key: 'b', bytes: Buffer.from('2') }]);
  assert.equal(attempts, 3); assert.deepEqual(JSON.parse(h.calls[1].body).map(e => e.key), ['b']);
  const always = harness(call => json({ success: true, result: { successful_key_count: 0, unsuccessful_keys: JSON.parse(call.body).map(e => e.key) } }));
  await assert.rejects(always.store.bulkPut([{ key: 'a', bytes: Buffer.from('1') }]), /bulk write failed/);
  assert.equal(always.calls.length, 4);
});
test('429 honours Retry-After, 5xx backs off, timeouts retry, then give up', async () => {
  let n = 0;
  const h = harness(() => (++n < 3 ? json({ success: false }, 429, { 'retry-after': '2' }) : new Response('v', { status: 200 })));
  assert.equal((await h.store.get('k')).toString(), 'v'); assert.deepEqual(h.sleeps, [2000, 2000]);
  const h5 = harness(() => json({ success: false }, 503));
  await assert.rejects(h5.store.get('k'), /→ 503/); assert.deepEqual(h5.sleeps, [1000, 2000, 4000]); assert.equal(h5.calls.length, 4);
  const abort = harness(() => { const e = new Error('aborted'); e.name = 'TimeoutError'; throw e; });
  await assert.rejects(abort.store.get('k'), /failed: TimeoutError/); assert.equal(abort.calls.length, 4);
});
test('same-key rate limiting: a 1-write-per-second key answers 429 until the clock moves; three consecutive 429s surface as an error', async () => {
  const written = new Map(); let clock = 0;
  const store = kvStore({ accountId: ACCOUNT, apiToken: 't', namespaceId: NS, sleep: async ms => { clock += ms; }, fetch: async (url, init) => {
    const key = decodeURIComponent(String(url).split('/values/')[1]);
    if (init.method === 'PUT') { const last = written.get(key); if (last !== undefined && clock - last < 1000) return json({ success: false }, 429, { 'retry-after': '1' }); written.set(key, clock); return json({ success: true }); }
    return new Response('x', { status: 200 });
  } });
  await store.put('docs/channels/preview.json', Buffer.from('a'));
  await store.put('docs/channels/preview.json', Buffer.from('b'));
  assert.equal(clock, 1000, 'second write waited for Retry-After once');
  const stuck = kvStore({ accountId: ACCOUNT, apiToken: 't', namespaceId: NS, sleep: async () => {}, fetch: async () => json({ success: false }, 429, { 'retry-after': '1' }) });
  await assert.rejects(stuck.put('docs/channels/preview.json', Buffer.from('c')), /→ 429/);
});
test('key and value limits are enforced before any request; 404 reads return null; oversized reads fail', async () => {
  const h = harness(() => new Response('{}', { status: 404 }));
  await assert.rejects(h.store.put('k'.repeat(513), Buffer.from('x')), /exceeds 512/);
  await assert.rejects(h.store.put('k', Buffer.alloc(KV_LIMITS.value + 1)), /exceeds 25 MiB/);
  await assert.rejects(h.store.bulkPut([{ key: '', bytes: Buffer.from('x') }]), /invalid/);
  assert.equal(h.calls.length, 0);
  assert.equal(await h.store.get('missing'), null);
  const big = harness(() => new Response(Buffer.alloc(10), { status: 200, headers: { 'content-length': '10' } }));
  await assert.rejects(big.store.get('k', 5), /exceeds limit/);
  assert.throws(() => kvStore({ accountId: 'short', apiToken: 't', namespaceId: NS }), /account/);
  assert.throws(() => cloudflareApi({ accountId: ACCOUNT, apiToken: '' }), /token/);
});

/** In-memory KV REST backend for the real adapter: list / get / put / bulk / bulk-delete, with a hook per request. */
function kvBackend({ intercept = () => null } = {}) {
  const objects = new Map(); const puts = [];
  const fetch = async (url, init) => {
    const u = new URL(String(url)); const path = u.pathname.split('/storage/kv/namespaces/')[1].split('/').slice(1).join('/');
    const hijack = intercept({ url: u, init, path, objects }); if (hijack) return hijack;
    if (path === 'keys') { const prefix = u.searchParams.get('prefix') ?? ''; return json({ success: true, result: [...objects.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), result_info: { cursor: '' } }); }
    if (path.startsWith('values/')) {
      const key = decodeURIComponent(path.slice(7));
      if (init.method === 'GET') { const v = objects.get(key); return v ? new Response(v, { status: 200 }) : new Response('{}', { status: 404 }); }
      if (init.method === 'PUT') { puts.push(key); objects.set(key, Buffer.from(init.body)); return json({ success: true }); }
    }
    if (path === 'bulk' && init.method === 'PUT') { for (const e of JSON.parse(init.body)) objects.set(e.key, Buffer.from(e.value, 'base64')); return json({ success: true, result: { successful_key_count: 1, unsuccessful_keys: [] } }); }
    if (path === 'bulk/delete') { for (const k of JSON.parse(init.body)) objects.delete(k); return json({ success: true, result: { successful_key_count: 1, unsuccessful_keys: [] } }); }
    throw new Error(`unhandled ${init.method} ${path}`);
  };
  return { objects, puts, fetch };
}
test('real adapter wired into the publisher: pointer PUT keeps answering 429 → adapter gives up → publisher ends unknown with marker present and pointer unchanged', async t => {
  const root = await fixtureRepo({ units: [intro(), { slug: 'g/a' }] }); t.after(() => cleanup(root));
  const commit = n => String(n).repeat(40);
  const rel = async n => { const r = await compile({ root, docsCommit: commit(n) }); return { r, objects: allObjects(r) }; };
  const [r1, r2] = [await rel(1), await rel(2)];
  let rateLimitPointer = false; const sleeps = [];
  const backend = kvBackend({ intercept: ({ init, path }) => rateLimitPointer && init.method === 'PUT' && path === `values/${encodeURIComponent(KEYS.pointer('preview'))}` ? json({ success: false }, 429, { 'retry-after': '1' }) : null });
  const kv = kvStore({ accountId: ACCOUNT, apiToken: 't', namespaceId: NS, fetch: backend.fetch, sleep: async ms => { sleeps.push(ms); } });
  const r2store = memoryStore('r2');
  const publish = x => activate({ kv, r2: r2store, channel: 'preview', mode: 'publish', manifestBytes: x.r.channels.preview.manifestBytes, objects: x.objects, assetBytes: x.r.assetBytes, head: async () => x.r.channels.preview.manifest.docsCommit, isAncestor: async () => true, sleep: async () => {} });
  assert.equal((await publish(r1)).status, 'published');
  const before = Buffer.from(backend.objects.get(KEYS.pointer('preview')));
  const pointerPuts = () => backend.puts.filter(k => k === KEYS.pointer('preview')).length;
  rateLimitPointer = true; const putsBefore = pointerPuts();
  const result = await publish(r2);
  assert.equal(result.status, 'unknown');
  assert.ok(await readMarker(kv, r2.r.channels.preview.releaseId), 'marker was written before the pointer attempts');
  assert.ok(backend.objects.get(KEYS.pointer('preview')).equals(before), 'pointer unchanged');
  assert.equal(pointerPuts(), putsBefore, 'no pointer value landed');
  assert.equal(sleeps.filter(ms => ms === 1000).length, 3 * POINTER_PUT_ATTEMPTS, 'each publisher attempt let the adapter honour Retry-After three times before giving up');
  rateLimitPointer = false;
  assert.equal((await publish(r2)).status, 'published', 'the next run completes normally');
});
