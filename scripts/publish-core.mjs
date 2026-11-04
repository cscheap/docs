// Activation per channel (contract v3, ADR 0006). Write order is objects → manifest → marker → pointer:
// a release can only enter a pointer after its marker is durable, so there is no half-finished state
// to repair later. Stores are plain get/list/put/bulkPut interfaces; one serialized writer is assumed
// (GitHub concurrency group), pointer re-reads are only a best-effort check for a second writer.
import { Manifest, Pointer, PublishedMarker, Digest, Channel, LIMITS, KEYS } from '../contracts/schema.ts';
import { digest, encode } from './compile.mjs';
import { mapLimit } from './cf-api.mjs';

export const POINTER_CONFIRM_ATTEMPTS = 3;
export const POINTER_PUT_ATTEMPTS = 3;
export const CONFIRM_DELAY_MS = 1000;

export function decode(bytes, schema, max) {
  if (!bytes || bytes.length > max) throw new Error('Missing or oversized object');
  return schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
/** Digest, schema, channel, non-local commit, reviewed baselines. */
export function verifyManifest(bytes, releaseId, channel) {
  Digest.parse(releaseId); Channel.parse(channel);
  if (!bytes || bytes.length > LIMITS.manifest) throw new Error('Missing or oversized manifest');
  if (digest(bytes) !== releaseId) throw new Error('Manifest digest mismatch');
  const manifest = decode(bytes, Manifest, LIMITS.manifest);
  if (manifest.channel !== channel) throw new Error(`Manifest belongs to channel ${manifest.channel}, not ${channel}`);
  if (manifest.docsCommit === '0'.repeat(40)) throw new Error('A local build cannot be published');
  if (Object.values(manifest.baselines).some(b => b.documentationReview !== 'reviewed')) throw new Error('Unreviewed baseline');
  return manifest;
}
export function referencedObjects(manifest) {
  return [...manifest.pages.map(p => p.object), ...Object.values(manifest.search)];
}
export async function readPointer(kv, channel) {
  const bytes = await kv.get(KEYS.pointer(channel), LIMITS.pointer);
  const pointer = bytes ? decode(bytes, Pointer, LIMITS.pointer) : null;
  if (pointer && pointer.channel !== channel) throw new Error('Pointer channel mismatch');
  return { bytes, pointer };
}
export async function readMarker(kv, releaseId) {
  const bytes = await kv.get(KEYS.marker(releaseId), LIMITS.marker);
  if (!bytes) return null;
  const marker = decode(bytes, PublishedMarker, LIMITS.marker);
  if (marker.releaseId !== releaseId) throw new Error('Marker identity mismatch');
  return marker;
}
const sameIdentity = (a, b) => a.releaseId === b.releaseId && a.docsCommit === b.docsCommit && a.channel === b.channel;
/** Every release referenced by a pointer must carry a matching marker (invariant: marker precedes pointer). */
export async function assertPointerMarkers(kv, pointer) {
  for (const ref of [pointer?.current, pointer?.previous]) {
    if (!ref) continue;
    const marker = await readMarker(kv, ref.releaseId);
    if (!marker || !sameIdentity(marker, { ...ref, channel: pointer.channel })) throw new Error(`Pointer references ${ref.releaseId.slice(0, 12)} without a matching marker`);
  }
}
/** Rollback / explicit-read eligibility (§4.2): identity must agree between pointer-or-marker and the manifest. */
export async function admit(kv, channel, manifest, releaseId, pointer) {
  const identity = { releaseId, docsCommit: manifest.docsCommit, channel };
  const ref = [pointer?.current, pointer?.previous].find(r => r?.releaseId === releaseId);
  if (ref) { if (ref.docsCommit !== manifest.docsCommit) throw new Error('Pointer docsCommit does not match the manifest'); return 'pointer'; }
  const marker = await readMarker(kv, releaseId);
  if (!marker) return null;
  if (!sameIdentity(marker, identity)) throw new Error(marker.channel !== channel ? `Release was activated for ${marker.channel}, not ${channel}` : 'Marker identity does not match the manifest');
  return 'marker';
}
export async function immutable(store, key, bytes, mime, max = Math.max(bytes.length, 1)) {
  const old = await store.get(key, max);
  if (old && !old.equals(bytes)) throw new Error(`Immutable object differs: ${key}`);
  if (!old) await store.put(key, bytes, mime);
  const readback = await store.get(key, max);
  if (!readback || !readback.equals(bytes)) throw new Error(`Readback verification failed: ${key}`);
}

/**
 * Returns { status, channel, releaseId, docsCommit } with status one of
 * published | already-current | skipped-stale | rolled-back | unknown. Throws before the switch for
 * every other failure (caller reports failed-before-switch; the pointer is untouched).
 */
export async function activate({
  kv, r2, channel, mode = 'publish', manifestBytes, releaseId, objects = new Map(), assetBytes = new Map(),
  head, isAncestor, now = () => new Date().toISOString(), sleep = ms => new Promise(r => setTimeout(r, ms)), concurrency = 10, log = () => {},
}) {
  Channel.parse(channel);
  if (!['publish', 'rollback'].includes(mode)) throw new Error('Invalid activation mode');
  if (mode === 'rollback') {
    Digest.parse(releaseId);
    manifestBytes = await kv.get(KEYS.manifest(releaseId), LIMITS.manifest);
    if (!manifestBytes) throw new Error('Rollback release manifest does not exist');
  } else { releaseId = digest(manifestBytes); }
  const manifest = verifyManifest(manifestBytes, releaseId, channel);
  const identity = { releaseId, docsCommit: manifest.docsCommit, channel };
  const before = await readPointer(kv, channel);

  if (mode === 'publish') {
    if (await head() !== manifest.docsCommit) return { status: 'skipped-stale', ...identity };
    if (before.pointer && !await isAncestor(before.pointer.current.docsCommit, manifest.docsCommit)) throw new Error('Publication must descend from the current docs commit');
    for (const ref of referencedObjects(manifest)) {
      const local = objects.get(ref.sha256);
      if (!local || local.length !== ref.size || digest(local) !== ref.sha256) throw new Error(`Build object mismatch: ${ref.sha256.slice(0, 12)}`);
    }
    for (const asset of Object.values(manifest.assets)) {
      const local = assetBytes.get(asset.key);
      if (!local || local.length !== asset.size || digest(local) !== asset.sha256) throw new Error(`Build asset mismatch: ${asset.key}`);
    }
  } else {
    const eligibility = await admit(kv, channel, manifest, releaseId, before.pointer);
    if (!eligibility) throw new Error('Rollback requires a previously activated release of this channel');
    log(`rollback eligibility: ${eligibility}`);
  }

  // Remote objects: publish uploads whatever list() does not show (list may lag; re-uploading identical
  // content-addressed bytes is harmless), then every referenced object is verified by point read.
  // Rollback never uploads: a reference that fails the point read fails the rollback.
  const refs = referencedObjects(manifest);
  if (mode === 'publish') {
    const existing = new Set(await kv.list(KEYS.objectsPrefix));
    const missing = refs.filter(ref => !existing.has(KEYS.object(ref.sha256)));
    if (missing.length) {
      const batches = await kv.bulkPut(missing.map(ref => ({ key: KEYS.object(ref.sha256), bytes: objects.get(ref.sha256) })));
      log(`uploaded ${missing.length} objects in ${batches} batches`);
    }
  }
  await mapLimit(refs, concurrency, async ref => {
    const bytes = await kv.get(KEYS.object(ref.sha256), ref.size);
    if (!bytes || bytes.length !== ref.size || digest(bytes) !== ref.sha256) throw new Error(`Remote object verification failed: ${ref.sha256.slice(0, 12)}`);
  });
  for (const asset of Object.values(manifest.assets)) {
    if (mode === 'publish') await immutable(r2, asset.key, assetBytes.get(asset.key), asset.mime, asset.size);
    else {
      const bytes = await r2.get(asset.key, asset.size);
      if (!bytes || bytes.length !== asset.size || digest(bytes) !== asset.sha256) throw new Error(`Asset verification failed: ${asset.key}`);
    }
  }
  if (mode === 'publish') await immutable(kv, KEYS.manifest(releaseId), manifestBytes, 'application/json', LIMITS.manifest);

  // Switch phase.
  if (mode === 'publish' && await head() !== manifest.docsCommit) return { status: 'skipped-stale', ...identity };
  const latest = await readPointer(kv, channel);
  if (!((!before.bytes && !latest.bytes) || (before.bytes && latest.bytes && before.bytes.equals(latest.bytes)))) throw new Error('Pointer changed: another writer exists');
  await assertPointerMarkers(kv, latest.pointer);
  await immutable(kv, KEYS.marker(releaseId), encode({ schemaVersion: 3, ...identity }), 'application/json', LIMITS.marker);
  if (latest.pointer?.current.releaseId === releaseId) return { status: 'already-current', ...identity };
  const pointer = Pointer.parse({ schemaVersion: 3, channel, current: { releaseId, docsCommit: manifest.docsCommit }, previous: latest.pointer?.current ?? null, activatedAt: now() });
  const pointerBytes = encode(pointer);
  const confirmed = async () => {
    for (let attempt = 0; attempt < POINTER_CONFIRM_ATTEMPTS; attempt += 1) {
      if (attempt) await sleep(CONFIRM_DELAY_MS);
      let bytes = null; try { bytes = await kv.get(KEYS.pointer(channel), LIMITS.pointer); } catch { continue; }
      if (bytes?.equals(pointerBytes)) return true;
    }
    return false;
  };
  const done = { status: mode === 'rollback' ? 'rolled-back' : 'published', ...identity };
  // Write-after confirmation (§3.3 item 7): a PUT that returned success is never repeated — if its
  // three confirmation reads do not show the new value the outcome is unknown. Only a PUT whose
  // result is unknown (it threw) is retried, and only after a re-read failed to show the value.
  for (let attempt = 0; attempt < POINTER_PUT_ATTEMPTS; attempt += 1) {
    let putOk = true;
    try { await kv.put(KEYS.pointer(channel), pointerBytes, 'application/json'); }
    catch (error) { putOk = false; log(`pointer write attempt ${attempt + 1} failed: ${error.message}`); }
    if (await confirmed()) return done;
    if (putOk) return { status: 'unknown', ...identity };
  }
  return { status: 'unknown', ...identity };
}

export const FAILED_STATUSES = Object.freeze(['failed-before-switch', 'unknown']);
/**
 * Two-channel orchestration (§4.5): `build()` runs once for all channels — a failure means zero
 * activations; then every channel is activated in order, each capturing its own error. Returns the
 * per-channel results and the process exit code (1 if any channel failed or ended unknown).
 */
export async function activateChannels({ channels, build, activate: run, log = () => {} }) {
  let built;
  try { built = await build(); } catch (error) { log(`build failed: ${error.message}`); return { results: {}, exitCode: 1, error: error.message }; }
  const results = {};
  for (const channel of channels) {
    results[channel] = await run(channel, built).catch(error => ({ status: 'failed-before-switch', channel, error: error.message.slice(0, 500) }));
    log(JSON.stringify(results[channel]));
  }
  return { results, exitCode: Object.values(results).some(r => FAILED_STATUSES.includes(r.status)) ? 1 : 0 };
}
