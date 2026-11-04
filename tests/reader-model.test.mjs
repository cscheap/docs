// TC-16: the read protocol reference implementation over an eventually-visible in-memory store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, encode } from '../scripts/compile.mjs';
import { activate } from '../scripts/publish-core.mjs';
import { memoryStore } from '../scripts/store.mjs';
import { resolve, resolvePage, resolveExplicit, resolveExplicitObjects, pageNeed, searchNeed, CACHE_TTL } from '../scripts/reader-model.mjs';
import { KEYS } from '../contracts/schema.ts';
import { fixtureRepo, intro, cleanup, allObjects } from './helpers.mjs';

const root = await fixtureRepo({ units: [intro(), { slug: 'g/a' }] });
const roots = [root];
test.after(() => Promise.all(roots.map(cleanup)));
const commit = n => String(n).repeat(40);
/** Each release has distinct page content for g/a so page objects differ between releases. */
async function release(n) {
  const dir = await fixtureRepo({ units: [intro(), { slug: 'g/a', en: { body: `## A\n\nVersion ${n}.\n` } }] }); roots.push(dir);
  const r = await compile({ root: dir, docsCommit: commit(n) }); return { r, objects: allObjects(r), assetBytes: r.assetBytes };
}
const pageRef = (rel, locale, slug, channel = 'preview') => rel.r.channels[channel].manifest.pages.find(p => p.locale === locale && p.slug === slug).object;
function readerStore(kv) {
  const ttls = [];
  return { ttls, get: async (key, options) => { ttls.push([key, options?.cacheTtl]); return kv.get(key); } };
}
const stores = () => ({ kv: memoryStore('kv'), r2: memoryStore('r2') });
const publish = (s, rel, channel = 'preview') => activate({ ...s, channel, mode: 'publish', manifestBytes: rel.r.channels[channel].manifestBytes, objects: rel.objects, assetBytes: rel.assetBytes, head: async () => commit(rel.r.channels[channel].manifest.docsCommit[0]), isAncestor: async () => true, sleep: async () => {} });
const hide = (kv, key, times = -1) => kv.stale(key, undefined, times);

test('current → previous → unavailable at object level, never mixing releases', async () => {
  const s = stores(), r1 = await release(1), r2 = await release(2);
  const a = await publish(s, r1), b = await publish(s, r2);
  const reader = readerStore(s.kv);
  let out = await resolvePage(reader, 'preview', 'en', 'g/a');
  assert.equal(out.status, 'ok'); assert.equal(out.source, 'current'); assert.equal(out.releaseId, b.releaseId); assert.equal(out.objects[0].slug, 'g/a');
  // The current release's page object is invisible while its manifest is visible → whole release skipped.
  hide(s.kv, KEYS.object(pageRef(r2, 'en', 'g/a').sha256));
  out = await resolvePage(reader, 'preview', 'en', 'g/a');
  assert.equal(out.status, 'ok'); assert.equal(out.source, 'previous'); assert.equal(out.releaseId, a.releaseId);
  assert.match(out.objects[0].body.children[1].children[0].value, /Version 1/);
  // Multi-object request: one of two required objects invisible in current → both come from previous.
  const both = m => [...pageNeed('en', 'g/a')(m), ...searchNeed('en')(m)];
  out = await resolve(reader, 'preview', both);
  assert.equal(out.source, 'previous'); assert.equal(out.objects.length, 2); assert.equal(out.objects[1].locale, 'en');
  const manifestA = r1.r.channels.preview.manifest; assert.equal(out.objects[1].pages.length, manifestA.pages.filter(p => p.locale === 'en').length);
  // previous's object also invisible → unavailable.
  hide(s.kv, KEYS.object(pageRef(r1, 'en', 'g/a').sha256));
  out = await resolvePage(reader, 'preview', 'en', 'g/a');
  assert.equal(out.status, 'unavailable'); assert.equal(out.reason, 'no-readable-release');
  s.kv.staleReads.clear();
  assert.equal((await resolvePage(reader, 'preview', 'en', 'nope')).status, 'not-found');
  assert.equal((await resolvePage(reader, 'preview', 'en', 'g/a')).source, 'current', 'recovers once visible');
});
test('store exceptions degrade like missing keys: release reads fall back, pointer reads become unavailable', async () => {
  const s = stores(), r1 = await release(1), r2 = await release(2); const a = await publish(s, r1); const b = await publish(s, r2);
  const reader = readerStore(s.kv);
  s.kv.failGet = key => key === KEYS.object(pageRef(r2, 'en', 'g/a').sha256);
  let out = await resolvePage(reader, 'preview', 'en', 'g/a'); assert.equal(out.source, 'previous'); assert.equal(out.releaseId, a.releaseId);
  s.kv.failGet = key => key === KEYS.manifest(b.releaseId);
  out = await resolvePage(reader, 'preview', 'en', 'g/a'); assert.equal(out.source, 'previous');
  s.kv.failGet = key => key === KEYS.pointer('preview');
  out = await resolvePage(reader, 'preview', 'en', 'g/a'); assert.equal(out.status, 'unavailable'); assert.equal(out.reason, 'pointer-error');
  assert.equal((await resolveExplicit(reader, 'preview', b.releaseId)).status, 'unavailable');
  s.kv.failGet = key => key === KEYS.manifest(b.releaseId);
  assert.deepEqual(await resolveExplicit(reader, 'preview', b.releaseId), { status: 'unavailable', reason: 'store-error' });
});
test('read-time validation is shallow: a page whose body would fail the compile-time contract is still served when its digest matches', async () => {
  const s = stores(), r1 = await release(1); await publish(s, r1);
  const reader = readerStore(s.kv);
  const ref = pageRef(r1, 'en', 'g/a');
  const tampered = JSON.parse(s.kv.objects.get(KEYS.object(ref.sha256)));
  tampered.body.children.push({ type: 'element', tagName: 'script', properties: { onClick: 'x' }, children: [] });
  const bytes = encode(tampered); const sha = (await import('../scripts/unit.mjs')).digest(bytes);
  s.kv.objects.set(KEYS.object(sha), bytes);
  const manifest = JSON.parse(s.kv.objects.get(KEYS.manifest((await readPointerId(s)))));
  const entry = manifest.pages.find(p => p.locale === 'en' && p.slug === 'g/a'); entry.object = { sha256: sha, size: bytes.length };
  const manifestBytes = encode(manifest); const releaseId = (await import('../scripts/unit.mjs')).digest(manifestBytes);
  s.kv.objects.set(KEYS.manifest(releaseId), manifestBytes);
  s.kv.objects.set(KEYS.pointer('preview'), encode({ schemaVersion: 3, channel: 'preview', current: { releaseId, docsCommit: commit(1) }, previous: null, activatedAt: '2026-11-04T00:00:00.000Z' }));
  const out = await resolvePage(reader, 'preview', 'en', 'g/a');
  assert.equal(out.status, 'ok', 'no deep body validation at read time'); assert.equal(out.objects[0].body.children.at(-1).tagName, 'script');
  // Top-level damage is still rejected (digest + shallow schema).
  const broken = structuredClone(tampered); delete broken.slug; const brokenBytes = encode(broken);
  s.kv.objects.set(KEYS.object(sha), brokenBytes);
  assert.equal((await resolvePage(reader, 'preview', 'en', 'g/a')).status, 'unavailable', 'digest mismatch → release unusable');
});
async function readPointerId(s) { return JSON.parse(s.kv.objects.get(KEYS.pointer('preview'))).current.releaseId; }
test('first release not yet visible, indefinitely invisible, missing or invalid pointer', async () => {
  const s = stores(), r1 = await release(1); const a = await publish(s, r1);
  const reader = readerStore(s.kv);
  hide(s.kv, KEYS.manifest(a.releaseId), 2);
  assert.deepEqual((await resolvePage(reader, 'preview', 'en', 'g/a')).reason, 'first-release-not-visible');
  assert.deepEqual((await resolvePage(reader, 'preview', 'en', 'g/a')).reason, 'first-release-not-visible');
  assert.equal((await resolvePage(reader, 'preview', 'en', 'g/a')).status, 'ok', 'visible on the third read');
  hide(s.kv, KEYS.manifest(a.releaseId), -1);
  for (let i = 0; i < 5; i += 1) assert.equal((await resolvePage(reader, 'preview', 'en', 'g/a')).status, 'unavailable', 'no time-based assumption');
  s.kv.staleReads.clear();
  assert.equal((await resolvePage(reader, 'production', 'en', 'g/a')).reason, 'pointer', 'other channel has no pointer');
  s.kv.objects.set(KEYS.pointer('preview'), Buffer.from('{"schemaVersion":3}'));
  assert.equal((await resolvePage(reader, 'preview', 'en', 'g/a')).reason, 'pointer');
});
test('identity binding: pointer docsCommit or manifest channel mismatch makes a release unusable', async () => {
  const s = stores(), r1 = await release(1), r2 = await release(2); const a = await publish(s, r1); const b = await publish(s, r2);
  const reader = readerStore(s.kv);
  const pointer = JSON.parse(s.kv.objects.get(KEYS.pointer('preview'))); pointer.current.docsCommit = commit(7); s.kv.objects.set(KEYS.pointer('preview'), encode(pointer));
  const out = await resolvePage(reader, 'preview', 'en', 'g/a'); assert.equal(out.source, 'previous'); assert.equal(out.releaseId, a.releaseId);
  // production pointer wrongly referencing a preview manifest
  s.kv.objects.set(KEYS.pointer('production'), encode({ schemaVersion: 3, channel: 'production', current: { releaseId: b.releaseId, docsCommit: commit(2) }, previous: null, activatedAt: '2026-11-04T00:00:00.000Z' }));
  assert.equal((await resolvePage(reader, 'production', 'en', 'g/a')).status, 'unavailable');
});
test('explicit release reads: pointer path, marker path, cross-channel, unactivated, identity mismatches and missing objects', async () => {
  const s = stores(), r1 = await release(1), r2 = await release(2), r3 = await release(3);
  const a = await publish(s, r1), b = await publish(s, r2), c = await publish(s, r3);
  const reader = readerStore(s.kv);
  assert.equal((await resolveExplicit(reader, 'preview', c.releaseId)).eligibility, 'pointer');
  assert.equal((await resolveExplicit(reader, 'preview', b.releaseId)).eligibility, 'pointer');
  assert.equal((await resolveExplicit(reader, 'preview', a.releaseId)).eligibility, 'marker');
  assert.equal((await resolveExplicit(reader, 'production', a.releaseId)).reason, 'channel', 'preview manifest is never served to production');
  // Explicit object reads: eligible release + missing object → 404, never another release.
  let obj = await resolveExplicitObjects(reader, 'preview', a.releaseId, pageNeed('en', 'g/a'));
  assert.equal(obj.status, 'ok'); assert.match(obj.objects[0].body.children[1].children[0].value, /Version 1/);
  hide(s.kv, KEYS.object(pageRef(r1, 'en', 'g/a').sha256));
  obj = await resolveExplicitObjects(reader, 'preview', a.releaseId, pageNeed('en', 'g/a'));
  assert.deepEqual(obj, { status: 'not-found', reason: 'object' });
  s.kv.staleReads.clear();
  s.kv.failGet = key => key === KEYS.object(pageRef(r1, 'en', 'g/a').sha256);
  assert.deepEqual(await resolveExplicitObjects(reader, 'preview', a.releaseId, pageNeed('en', 'g/a')), { status: 'unavailable', reason: 'store-error' }, 'a store exception on the object is never a 404');
  s.kv.failGet = null;
  assert.equal((await resolveExplicitObjects(reader, 'preview', a.releaseId, pageNeed('en', 'missing'))).reason, 'object');
  const prod = await publish(s, r1, 'production');
  s.kv.objects.delete(KEYS.pointer('production'));
  assert.equal((await resolveExplicit(reader, 'production', prod.releaseId)).eligibility, 'marker');
  s.kv.objects.delete(KEYS.marker(prod.releaseId));
  assert.equal((await resolveExplicit(reader, 'production', prod.releaseId)).reason, 'not-activated', 'only uploaded, no marker');
  // preview manifest + a production marker for the same id → rejected.
  s.kv.objects.delete(KEYS.pointer('preview'));
  s.kv.objects.set(KEYS.marker(a.releaseId), encode({ schemaVersion: 3, channel: 'production', releaseId: a.releaseId, docsCommit: commit(1) }));
  assert.equal((await resolveExplicit(reader, 'preview', a.releaseId)).reason, 'marker-identity');
  s.kv.objects.set(KEYS.marker(a.releaseId), encode({ schemaVersion: 3, channel: 'preview', releaseId: a.releaseId, docsCommit: commit(8) }));
  assert.equal((await resolveExplicit(reader, 'preview', a.releaseId)).reason, 'marker-identity');
  s.kv.objects.set(KEYS.pointer('preview'), encode({ schemaVersion: 3, channel: 'preview', current: { releaseId: c.releaseId, docsCommit: commit(9) }, previous: null, activatedAt: '2026-11-04T00:00:00.000Z' }));
  assert.equal((await resolveExplicit(reader, 'preview', c.releaseId)).reason, 'pointer-identity');
  assert.equal((await resolveExplicit(reader, 'preview', 'f'.repeat(64))).reason, 'manifest');
  assert.equal((await resolveExplicit(reader, 'preview', 'short')).reason, 'invalid-id');
  for (const out of [await resolveExplicit(reader, 'preview', a.releaseId), await resolveExplicit(reader, 'preview', c.releaseId)]) assert.equal(out.manifest, undefined, 'rejections carry no content');
});
test('cacheTtl: pointer 60 s, immutable keys 30 s', async () => {
  const s = stores(), r1 = await release(1); await publish(s, r1);
  const reader = readerStore(s.kv);
  await resolvePage(reader, 'preview', 'en', 'g/a');
  const byKey = Object.fromEntries(reader.ttls);
  assert.equal(byKey[KEYS.pointer('preview')], 60); assert.equal(CACHE_TTL.pointer, 60);
  for (const [key, ttl] of reader.ttls) if (!key.startsWith('docs/channels/')) assert.equal(ttl, 30, key);
});
