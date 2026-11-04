// TC-09: activation protocol on in-memory stores (marker precedes pointer; stale reads; rollback).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, digest, encode } from '../scripts/compile.mjs';
import { activate, activateChannels, admit, readPointer, readMarker, verifyManifest, assertPointerMarkers } from '../scripts/publish-core.mjs';
import { memoryStore } from '../scripts/store.mjs';
import { KEYS, LIMITS } from '../contracts/schema.ts';
import { fixtureRepo, intro, cleanup, allObjects, PNG_1X1 } from './helpers.mjs';

const root = await fixtureRepo({ units: [intro(), { slug: 'g/a', en: { body: '## A\n\n![d](/assets/d.png)\n' } }, { slug: 'g/r', stage: 'reviewed' }], assets: { 'd.png': PNG_1X1 } });
test.after(() => cleanup(root));
const commit = n => String(n).repeat(40);
const compiled = new Map();
async function release(n, { extra } = {}) {
  const key = `${n}:${extra ?? ''}`;
  if (!compiled.has(key)) {
    const r = extra ? await (async () => { const { writeUnit } = await import('./helpers.mjs'); const dir = await fixtureRepo({ units: [intro(), { slug: 'g/a' }, { slug: 'g/r', stage: 'reviewed' }, { slug: extra }] }); const out = await compile({ root: dir, docsCommit: commit(n) }); await cleanup(dir); return out; })() : await compile({ root, docsCommit: commit(n) });
    compiled.set(key, r);
  }
  const r = compiled.get(key);
  return { result: r, objects: allObjects(r), assetBytes: r.assetBytes, manifestBytes: c => r.channels[c].manifestBytes, releaseId: c => r.channels[c].releaseId };
}
const stores = () => ({ kv: memoryStore('kv'), r2: memoryStore('r2') });
const stamp = () => '2026-11-04T00:00:00.000Z';
async function publish(s, r, channel = 'preview', extra = {}) {
  return activate({ ...s, channel, mode: 'publish', manifestBytes: r.manifestBytes(channel), objects: r.objects, assetBytes: r.assetBytes, head: async () => r.result.channels[channel].manifest.docsCommit, isAncestor: async (a, b) => a <= b, now: stamp, sleep: async () => {}, ...extra });
}
const rollback = (s, releaseId, channel = 'preview', extra = {}) => activate({ ...s, channel, mode: 'rollback', releaseId, head: async () => 'x', isAncestor: async () => true, now: stamp, sleep: async () => {}, ...extra });
async function invariant(s, channel = 'preview') {
  const { pointer } = await readPointer(s.kv, channel);
  await assertPointerMarkers(s.kv, pointer);
  return pointer;
}

test('first publish, incremental publish, previous chain and markers', async () => {
  const s = stores(), r1 = await release(1), r2 = await release(2, { extra: 'g/new' });
  const a = await publish(s, r1); assert.equal(a.status, 'published');
  const writesAfterFirst = s.kv.writes.length;
  const b = await publish(s, r2); assert.equal(b.status, 'published');
  const objectWrites = s.kv.writes.slice(writesAfterFirst).filter(k => k.startsWith(KEYS.objectsPrefix));
  assert.equal(objectWrites.length, 3, 'second release writes only what changed: the new page, the changed g/a page and the en search index');
  const same = stores(); await publish(same, r1); const w = same.kv.writes.length; await publish(same, await release(2));
  assert.equal(same.kv.writes.slice(w).filter(k => k.startsWith(KEYS.objectsPrefix)).length, 0, 'identical content re-uses every object');
  const pointer = await invariant(s);
  assert.equal(pointer.current.releaseId, r2.releaseId('preview')); assert.equal(pointer.previous.releaseId, r1.releaseId('preview'));
  assert.equal(await admit(s.kv, 'preview', verifyManifest(r1.manifestBytes('preview'), r1.releaseId('preview'), 'preview'), r1.releaseId('preview'), pointer), 'pointer');
  const order = s.kv.writes.filter(k => k.startsWith('docs/published/') || k.startsWith('docs/channels/'));
  assert.deepEqual(order, [KEYS.marker(r1.releaseId('preview')), KEYS.pointer('preview'), KEYS.marker(r2.releaseId('preview')), KEYS.pointer('preview')], 'marker is written before the pointer');
});
test('stale before upload and stale during upload both skip without writing a marker', async () => {
  const s = stores(), r1 = await release(1), r2 = await release(2);
  await publish(s, r2);
  assert.equal((await publish(s, r1, 'preview', { head: async () => commit(2) })).status, 'skipped-stale');
  let calls = 0;
  const s2 = stores(); await publish(s2, r1);
  assert.equal((await publish(s2, r2, 'preview', { head: async () => ++calls === 1 ? commit(2) : commit(3) })).status, 'skipped-stale');
  assert.equal((await readPointer(s2.kv, 'preview')).pointer.current.releaseId, r1.releaseId('preview'));
  assert.equal(await readMarker(s2.kv, r2.releaseId('preview')), null);
});
test('non-descendant publication is rejected', async () => {
  const s = stores(); await publish(s, await release(2));
  await assert.rejects(publish(s, await release(1)), /descend/);
});
test('object upload failure, corrupt existing object and differing manifest all leave the pointer untouched', async () => {
  const s = stores(), r1 = await release(1), r2 = await release(2, { extra: 'g/new' });
  await publish(s, r1); const before = s.kv.objects.get(KEYS.pointer('preview'));
  const newObject = [...r2.objects.keys()].find(sha => !s.kv.objects.has(KEYS.object(sha)));
  s.kv.failPut = key => key === KEYS.object(newObject);
  await assert.rejects(publish(s, r2), /Injected write failure/);
  s.kv.failPut = null;
  s.kv.objects.set(KEYS.object(newObject), Buffer.from('corrupt'));
  await assert.rejects(publish(s, r2), /Remote object verification failed/);
  assert.ok(s.kv.objects.get(KEYS.object(newObject)).equals(Buffer.from('corrupt')), 'corrupt object is not overwritten');
  s.kv.objects.delete(KEYS.object(newObject));
  s.kv.objects.set(KEYS.manifest(r2.releaseId('preview')), Buffer.from('other'));
  await assert.rejects(publish(s, r2), /Immutable object differs/);
  assert.ok(s.kv.objects.get(KEYS.pointer('preview')).equals(before));
});
test('marker write failure fails before the switch; every pointer reference always has a matching marker', async () => {
  const s = stores(), r1 = await release(1);
  s.kv.failPut = key => key === KEYS.marker(r1.releaseId('preview'));
  await assert.rejects(publish(s, r1), /Injected write failure/);
  assert.equal((await readPointer(s.kv, 'preview')).pointer, null);
  s.kv.failPut = null; assert.equal((await publish(s, r1)).status, 'published'); await invariant(s);
});
test('corrupt or mismatched markers block the switch; a pointer referencing an unmarked release is refused', async () => {
  const s = stores(), r1 = await release(1), r2 = await release(2);
  await publish(s, r1);
  s.kv.objects.set(KEYS.marker(r1.releaseId('preview')), Buffer.from('{}'));
  await assert.rejects(publish(s, r2), /Missing or oversized object|Expected|invalid/i);
  s.kv.objects.set(KEYS.marker(r1.releaseId('preview')), encode({ schemaVersion: 3, channel: 'production', releaseId: r1.releaseId('preview'), docsCommit: commit(1) }));
  await assert.rejects(publish(s, r2), /without a matching marker/);
  s.kv.objects.delete(KEYS.marker(r1.releaseId('preview')));
  await assert.rejects(publish(s, r2), /without a matching marker/);
});
test('already-current rerun is idempotent', async () => {
  const s = stores(), r1 = await release(1); await publish(s, r1);
  const before = s.kv.objects.get(KEYS.pointer('preview'));
  assert.equal((await publish(s, r1)).status, 'already-current');
  assert.ok(s.kv.objects.get(KEYS.pointer('preview')).equals(before));
});
test('pointer PUT with unknown outcome: confirmed by re-read → published; re-read stale then retry → published; never confirmed → unknown with marker present', async () => {
  const r1 = await release(1), r2 = await release(2);
  // PUT throws but the write actually landed.
  let s = stores(); await publish(s, r1);
  const realPut = s.kv.put.bind(s.kv); s.kv.put = async (k, b) => { await realPut(k, b); if (k === KEYS.pointer('preview')) throw new Error('timeout'); };
  assert.equal((await publish(s, r2)).status, 'published');
  // PUT succeeds, first re-read stale, second fresh.
  s = stores(); await publish(s, r1);
  const old = s.kv.objects.get(KEYS.pointer('preview')); s.kv.stale(KEYS.pointer('preview'), old, 1);
  const beforeWrites = s.kv.writes.length;
  const reads = []; const origGet = s.kv.get.bind(s.kv); s.kv.get = async (k, m) => { if (k === KEYS.pointer('preview')) reads.push(k); return origGet(k, m); };
  s.kv.staleReads.clear(); s.kv.stale(KEYS.pointer('preview'), old, 0);
  // make staleness kick in only after the write: wrap put to arm the stale read
  s.kv.put = async (k, b) => { s.kv.writes.push(k); s.kv.objects.set(k, Buffer.from(b)); if (k === KEYS.pointer('preview')) s.kv.stale(k, old, 1); };
  assert.equal((await publish(s, r2)).status, 'published');
  assert.equal(s.kv.writes.slice(beforeWrites).filter(k => k === KEYS.pointer('preview')).length, 1, 'one PUT, confirmed on the second read');
  // PUT returned success but confirmation never shows the value: exactly one PUT, then unknown.
  s = stores(); await publish(s, r1);
  const stuck = s.kv.objects.get(KEYS.pointer('preview'));
  s.kv.put = async (k, b) => { s.kv.writes.push(k); s.kv.objects.set(k, Buffer.from(b)); if (k === KEYS.pointer('preview')) s.kv.stale(k, stuck, -1); };
  const result = await publish(s, r2);
  assert.equal(result.status, 'unknown');
  assert.ok(await readMarker(s.kv, r2.releaseId('preview')), 'marker exists even when the switch is unknown');
  assert.equal(s.kv.writes.filter(k => k === KEYS.pointer('preview')).length, 1 + 1, 'a successful PUT is never repeated');
  // PUT threw and did not land; the retry lands and confirms.
  s = stores(); await publish(s, r1);
  let puts = 0; const landing = s.kv.put.bind(s.kv);
  s.kv.put = async (k, b) => { if (k === KEYS.pointer('preview') && ++puts === 1) throw new Error('connection reset before the write'); return landing(k, b); };
  assert.equal((await publish(s, r2)).status, 'published'); assert.equal(puts, 2);
  // PUT threw every time and never landed: bounded to three PUTs, unknown, marker present, pointer unchanged.
  s = stores(); await publish(s, r1); const old2 = s.kv.objects.get(KEYS.pointer('preview'));
  const landing2 = s.kv.put.bind(s.kv); puts = 0;
  s.kv.put = async (k, b) => { if (k === KEYS.pointer('preview')) { puts += 1; throw new Error('429 exhausted'); } return landing2(k, b); };
  const gone = await publish(s, r2);
  assert.equal(gone.status, 'unknown'); assert.equal(puts, 3); assert.ok(s.kv.objects.get(KEYS.pointer('preview')).equals(old2)); assert.ok(await readMarker(s.kv, r2.releaseId('preview')));
  // Confirmation reads keep throwing: unknown.
  s = stores(); await publish(s, r1);
  const realGet = s.kv.get.bind(s.kv); let armed = false;
  s.kv.put = async (k, b) => { s.kv.writes.push(k); s.kv.objects.set(k, Buffer.from(b)); if (k === KEYS.pointer('preview')) armed = true; };
  s.kv.get = async (k, m) => { if (armed && k === KEYS.pointer('preview')) throw new Error('read timeout'); return realGet(k, m); };
  assert.equal((await publish(s, r2)).status, 'unknown');
});
test('stale pre-read: a later run reading an old pointer skips a version in the previous chain but never loses eligibility', async () => {
  const s = stores(), r1 = await release(1), r2 = await release(2), r3 = await release(3);
  await publish(s, r1);
  // B: switch outcome unknown (pointer actually written, then reads stuck on A).
  const a = s.kv.objects.get(KEYS.pointer('preview'));
  s.kv.put = async (k, b) => { s.kv.writes.push(k); s.kv.objects.set(k, Buffer.from(b)); if (k === KEYS.pointer('preview')) s.kv.stale(k, a, -1); };
  assert.equal((await publish(s, r2)).status, 'unknown');
  // C runs: still reads A before writing, confirms after writing.
  s.kv.put = async (k, b) => { s.kv.writes.push(k); s.kv.objects.set(k, Buffer.from(b)); if (k === KEYS.pointer('preview')) s.kv.staleReads.delete(k); };
  assert.equal((await publish(s, r3)).status, 'published');
  const pointer = await invariant(s);
  assert.equal(pointer.current.releaseId, r3.releaseId('preview')); assert.equal(pointer.previous.releaseId, r1.releaseId('preview'));
  assert.ok(await readMarker(s.kv, r2.releaseId('preview')));
  assert.equal(await admit(s.kv, 'preview', verifyManifest(r2.manifestBytes('preview'), r2.releaseId('preview'), 'preview'), r2.releaseId('preview'), pointer), 'marker');
  assert.equal((await rollback(s, r2.releaseId('preview'))).status, 'rolled-back');
  // Writer that always pre-reads stale but confirms after writing: every run publishes.
  const t = stores(); const first = await release(1); await publish(t, first);
  for (const n of [2, 3]) {
    const old = t.kv.objects.get(KEYS.pointer('preview'));
    t.kv.stale(KEYS.pointer('preview'), old, 2); // the two pre-switch reads
    t.kv.put = async (k, b) => { t.kv.writes.push(k); t.kv.objects.set(k, Buffer.from(b)); if (k === KEYS.pointer('preview')) t.kv.staleReads.delete(k); };
    assert.equal((await publish(t, await release(n))).status, 'published');
    await invariant(t);
  }
});
test('concurrent pointer change between read and switch is detected', async () => {
  const s = stores(), r1 = await release(1), r2 = await release(2); await publish(s, r1);
  const origList = s.kv.list.bind(s.kv);
  s.kv.list = async p => { s.kv.objects.set(KEYS.pointer('preview'), encode({ ...JSON.parse(s.kv.objects.get(KEYS.pointer('preview'))), activatedAt: '2027-01-01T00:00:00.000Z' })); return origList(p); };
  await assert.rejects(publish(s, r2), /another writer/);
});
test('rollback: previous, marker-only, unactivated, identity mismatch, cross-channel, missing object, bad asset', async () => {
  const s = stores(), r1 = await release(1), r2 = await release(2), r3 = await release(3);
  await publish(s, r1); await publish(s, r2); await publish(s, r3);
  await publish(s, r1, 'production');
  assert.equal((await rollback(s, r2.releaseId('preview'))).status, 'rolled-back');
  let pointer = await invariant(s); assert.equal(pointer.current.releaseId, r2.releaseId('preview')); assert.equal(pointer.previous.releaseId, r3.releaseId('preview'));
  assert.equal((await rollback(s, r1.releaseId('preview'))).status, 'rolled-back', 'marker-only release');
  pointer = await invariant(s); assert.equal(pointer.previous.releaseId, r2.releaseId('preview'));
  const before = Buffer.from(s.kv.objects.get(KEYS.pointer('preview'))), writes = s.kv.writes.length;
  const guessed = stores(); await publish(guessed, r1);
  guessed.kv.objects.set(KEYS.manifest(r2.releaseId('preview')), r2.manifestBytes('preview')); for (const [sha, bytes] of r2.objects) guessed.kv.objects.set(KEYS.object(sha), bytes);
  await assert.rejects(rollback(guessed, r2.releaseId('preview')), /previously activated/);
  // Pointer docsCommit mismatch on the rollback target itself.
  const p = JSON.parse(before); p.previous.docsCommit = commit(9); s.kv.objects.set(KEYS.pointer('preview'), encode(p));
  await assert.rejects(rollback(s, r2.releaseId('preview')), /Pointer docsCommit does not match/);
  s.kv.objects.set(KEYS.pointer('preview'), before);
  // Marker identity mismatch and cross-channel marker (r3 is marker-only now).
  s.kv.objects.set(KEYS.marker(r3.releaseId('preview')), encode({ schemaVersion: 3, channel: 'preview', releaseId: r3.releaseId('preview'), docsCommit: commit(8) }));
  await assert.rejects(rollback(s, r3.releaseId('preview')), /Marker identity does not match/);
  s.kv.objects.set(KEYS.marker(r3.releaseId('preview')), encode({ schemaVersion: 3, channel: 'production', releaseId: r3.releaseId('preview'), docsCommit: commit(3) }));
  await assert.rejects(rollback(s, r3.releaseId('preview')), /activated for production, not preview/);
  s.kv.objects.set(KEYS.marker(r3.releaseId('preview')), encode({ schemaVersion: 3, channel: 'preview', releaseId: r3.releaseId('preview'), docsCommit: commit(3) }));
  // Production channel manifest cannot be rolled into preview.
  await assert.rejects(rollback(s, r1.releaseId('production'), 'preview'), /belongs to channel production/);
  // Missing search object and bad asset.
  const search = r3.result.channels.preview.manifest.search.en.sha256; const saved = s.kv.objects.get(KEYS.object(search)); s.kv.objects.delete(KEYS.object(search));
  await assert.rejects(rollback(s, r3.releaseId('preview')), /Remote object verification failed/); s.kv.objects.set(KEYS.object(search), saved);
  const asset = Object.values(r3.result.channels.preview.manifest.assets)[0]; const goodAsset = s.r2.objects.get(asset.key); s.r2.objects.set(asset.key, Buffer.from('bad'));
  await assert.rejects(rollback(s, r3.releaseId('preview')), /Asset verification failed/); s.r2.objects.set(asset.key, goodAsset);
  assert.ok(s.kv.objects.get(KEYS.pointer('preview')).equals(before)); assert.equal(s.kv.writes.length, writes, 'rejected rollbacks write nothing');
});
test('rollback never uploads and does not depend on local objects', async () => {
  const s = stores(), r1 = await release(1), r2 = await release(2); await publish(s, r1); await publish(s, r2);
  const writes = s.kv.writes.length;
  assert.equal((await rollback(s, r1.releaseId('preview'))).status, 'rolled-back');
  assert.deepEqual(s.kv.writes.slice(writes), [KEYS.pointer('preview')]);
});
test('manifest verification: digest, schema, local commit, channel', () => {
  const r = compiled.get('1:'); const bytes = r.channels.preview.manifestBytes, id = r.channels.preview.releaseId;
  assert.throws(() => verifyManifest(Buffer.concat([bytes, Buffer.from(' ')]), id, 'preview'), /digest/);
  assert.throws(() => verifyManifest(bytes, id, 'production'), /belongs to channel preview/);
  const local = encode({ ...r.channels.preview.manifest, docsCommit: '0'.repeat(40) });
  assert.throws(() => verifyManifest(local, digest(local), 'preview'), /local build/);
  const v2 = encode({ ...r.channels.preview.manifest, schemaVersion: 2 });
  assert.throws(() => verifyManifest(v2, digest(v2), 'preview'));
  assert.throws(() => verifyManifest(Buffer.alloc(LIMITS.manifest + 1), 'a'.repeat(64), 'preview'), /oversized/);
});
test('two channels via activateChannels: build failure → zero activations; each outcome combination sets the exit code', async () => {
  const r1 = await release(1);
  const run = (s, hooks = {}) => activateChannels({ channels: ['preview', 'production'], build: async () => (hooks.build ? hooks.build() : r1), activate: (channel, rel) => publish(s, rel, channel, hooks[channel] ?? {}) });
  // build fails
  let s = stores();
  let out = await run(s, { build: async () => { throw new Error('channel production failed: link outside channel'); } });
  assert.equal(out.exitCode, 1); assert.deepEqual(out.results, {}); assert.equal(s.kv.writes.length, 0, 'no activation at all');
  // preview ok + production fails before switch
  s = stores(); s.kv.failPut = key => key === KEYS.marker(r1.releaseId('production'));
  out = await run(s);
  assert.equal(out.results.preview.status, 'published'); assert.equal(out.results.production.status, 'failed-before-switch'); assert.equal(out.exitCode, 1);
  assert.ok(s.kv.objects.has(KEYS.pointer('preview'))); assert.ok(!s.kv.objects.has(KEYS.pointer('production')));
  // preview fails + production ok (production still attempted)
  s = stores(); s.kv.failPut = key => key === KEYS.marker(r1.releaseId('preview'));
  out = await run(s);
  assert.equal(out.results.preview.status, 'failed-before-switch'); assert.equal(out.results.production.status, 'published'); assert.equal(out.exitCode, 1);
  assert.ok(!s.kv.objects.has(KEYS.pointer('preview'))); assert.ok(s.kv.objects.has(KEYS.pointer('production')));
  // preview ok + production unknown
  s = stores();
  const landing = s.kv.put.bind(s.kv);
  s.kv.put = async (k, b) => { await landing(k, b); if (k === KEYS.pointer('production')) s.kv.stale(k, undefined, -1); };
  out = await run(s);
  assert.equal(out.results.preview.status, 'published'); assert.equal(out.results.production.status, 'unknown'); assert.equal(out.exitCode, 1);
  assert.ok(await readMarker(s.kv, r1.releaseId('production'))); await invariant(s, 'preview');
  // both ok
  s = stores(); out = await run(s);
  assert.equal(out.exitCode, 0); assert.deepEqual(Object.values(out.results).map(r => r.status), ['published', 'published']);
  await invariant(s, 'preview'); await invariant(s, 'production');
});
