// Reference implementation of the read protocol (§3.3 of the v3 plan). The frontend ports this
// against its KV binding; here it runs over any `{ get(key, { cacheTtl }) }` store so the behaviour
// is testable without Cloudflare. Pure functions, no caching of its own except what the caller adds.
//
// Validation at read time is deliberately shallow: pointer, manifest and marker go through zod; page
// and search objects are checked by digest + length + top-level fields only. The body AST was fully
// validated at compile time and is rendered by an allowlist renderer, so re-validating it per request
// is exactly the CPU cost v3 removes.
import { z } from 'zod/v3';
import { Manifest, Pointer, PublishedMarker, LIMITS, KEYS, DocId, Locale, Slug, Kind, Channel } from '../contracts/schema.ts';
import { digest } from './unit.mjs';

export const CACHE_TTL = Object.freeze({ pointer: 60, immutable: 30 });

/** Top-level shape only; `body`, `toc` and `structuredData` are not walked. */
export const ShallowPage = z.object({
  schemaVersion: z.literal(3), docId: DocId, locale: Locale, slug: Slug, title: z.string(), description: z.string(), kind: Kind, deprecated: z.boolean(),
  body: z.object({ type: z.literal('root'), children: z.array(z.unknown()) }).strict(), toc: z.array(z.unknown()), structuredData: z.object({ headings: z.array(z.unknown()), contents: z.array(z.unknown()) }).strict(),
}).strict();
export const ShallowSearchIndex = z.object({ schemaVersion: z.literal(3), channel: Channel, locale: Locale, pages: z.array(z.unknown()) }).strict();

function parse(bytes, schema, max) {
  if (!bytes || bytes.length > max) return null;
  try { return schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); } catch { return null; }
}
/** A store exception is treated like a missing key for release objects (→ degrade), and surfaced for the pointer. */
async function read(store, key, cacheTtl) {
  try { return { bytes: await store.get(key, { cacheTtl }) }; } catch (error) { return { bytes: null, error }; }
}
async function readManifestBytes(store, releaseId) {
  const { bytes, error } = await read(store, KEYS.manifest(releaseId), CACHE_TTL.immutable);
  if (error || !bytes || bytes.length > LIMITS.manifest || digest(bytes) !== releaseId) return null;
  return parse(bytes, Manifest, LIMITS.manifest);
}
/** Manifest must hash to the release id, belong to the channel and carry the referenced commit. */
async function readManifest(store, channel, ref) {
  const manifest = await readManifestBytes(store, ref.releaseId);
  if (!manifest || manifest.channel !== channel || manifest.docsCommit !== ref.docsCommit) return null;
  return manifest;
}
/**
 * Content-addressed object: bytes must hash to the key and match the recorded length.
 * Returns { object } on success, { object: null } when missing/corrupt, { object: null, error } on a
 * store exception — implicit reads treat both as "skip this release", explicit reads must not turn an
 * exception into a 404.
 */
export async function readObjectResult(store, ref, schema, max) {
  const { bytes, error } = await read(store, KEYS.object(ref.sha256), CACHE_TTL.immutable);
  if (error) return { object: null, error };
  if (!bytes || bytes.length !== ref.size || digest(bytes) !== ref.sha256) return { object: null };
  return { object: parse(bytes, schema, max) };
}
export const readObject = async (store, ref, schema, max) => (await readObjectResult(store, ref, schema, max)).object;
export const readPage = (store, ref) => readObject(store, ref, ShallowPage, LIMITS.page);
export const readSearchIndex = (store, ref) => readObject(store, ref, ShallowSearchIndex, LIMITS.search);
export const pageNeed = (locale, slug) => manifest => {
  const page = manifest.pages.find(p => p.locale === locale && p.slug === slug);
  return page ? [{ ref: page.object, schema: ShallowPage, max: LIMITS.page }] : null;
};
export const searchNeed = locale => manifest => [{ ref: manifest.search[locale], schema: ShallowSearchIndex, max: LIMITS.search }];

/**
 * Implicit read: current → previous → unavailable. `need(manifest)` returns the object refs this
 * request requires (or null for "not in this release"); all of them must be readable from the same
 * release, otherwise the whole release is skipped. Result never mixes releases.
 */
export async function resolve(store, channel, need) {
  const { bytes: pointerBytes, error } = await read(store, KEYS.pointer(channel), CACHE_TTL.pointer);
  if (error) return { status: 'unavailable', reason: 'pointer-error' };
  const pointer = parse(pointerBytes, Pointer, LIMITS.pointer);
  if (!pointer || pointer.channel !== channel) return { status: 'unavailable', reason: 'pointer' };
  for (const [source, ref] of [['current', pointer.current], ['previous', pointer.previous]]) {
    if (!ref) continue;
    const manifest = await readManifest(store, channel, ref);
    if (!manifest) continue;
    const refs = need(manifest);
    if (refs === null) return { status: 'not-found', source, releaseId: ref.releaseId, manifest };
    const objects = [];
    let complete = true;
    for (const { ref: objectRef, schema, max } of refs) {
      const object = await readObject(store, objectRef, schema, max);
      if (!object) { complete = false; break; }
      objects.push(object);
    }
    if (!complete) continue;
    return { status: 'ok', source, releaseId: ref.releaseId, manifest, objects };
  }
  return { status: 'unavailable', reason: pointer.previous ? 'no-readable-release' : 'first-release-not-visible' };
}
/** Convenience: resolve one page of one locale. */
export const resolvePage = (store, channel, locale, slug) => resolve(store, channel, pageNeed(locale, slug));

/**
 * Explicit release read (search / assets routes): identity must agree between the manifest and
 * either this channel's pointer or this channel's marker. Anything else is 404, never a fallback;
 * a store exception is reported as unavailable (the caller answers 503), not as 404.
 */
export async function resolveExplicit(store, channel, releaseId) {
  if (!/^[a-f0-9]{64}$/.test(releaseId)) return { status: 'not-found', reason: 'invalid-id' };
  const m = await read(store, KEYS.manifest(releaseId), CACHE_TTL.immutable);
  if (m.error) return { status: 'unavailable', reason: 'store-error' };
  if (!m.bytes || m.bytes.length > LIMITS.manifest || digest(m.bytes) !== releaseId) return { status: 'not-found', reason: 'manifest' };
  const manifest = parse(m.bytes, Manifest, LIMITS.manifest);
  if (!manifest || manifest.channel !== channel) return { status: 'not-found', reason: 'channel' };
  const p = await read(store, KEYS.pointer(channel), CACHE_TTL.pointer);
  if (p.error) return { status: 'unavailable', reason: 'store-error' };
  const pointer = parse(p.bytes, Pointer, LIMITS.pointer);
  const ref = pointer?.channel === channel ? [pointer.current, pointer.previous].find(r => r?.releaseId === releaseId) : null;
  if (ref) return ref.docsCommit === manifest.docsCommit ? { status: 'ok', eligibility: 'pointer', manifest } : { status: 'not-found', reason: 'pointer-identity' };
  const k = await read(store, KEYS.marker(releaseId), CACHE_TTL.immutable);
  if (k.error) return { status: 'unavailable', reason: 'store-error' };
  const marker = parse(k.bytes, PublishedMarker, LIMITS.marker);
  if (marker && marker.releaseId === releaseId && marker.channel === channel && marker.docsCommit === manifest.docsCommit) return { status: 'ok', eligibility: 'marker', manifest };
  return { status: 'not-found', reason: marker ? 'marker-identity' : 'not-activated' };
}
/** Explicit object read: eligible release + the object it references, or 404; never another release. */
export async function resolveExplicitObjects(store, channel, releaseId, need) {
  const release = await resolveExplicit(store, channel, releaseId);
  if (release.status !== 'ok') return release;
  const refs = need(release.manifest);
  if (refs === null) return { status: 'not-found', reason: 'object' };
  const objects = [];
  for (const { ref, schema, max } of refs) {
    const { object, error } = await readObjectResult(store, ref, schema, max);
    if (error) return { status: 'unavailable', reason: 'store-error' };
    if (!object) return { status: 'not-found', reason: 'object' };
    objects.push(object);
  }
  return { ...release, objects };
}
