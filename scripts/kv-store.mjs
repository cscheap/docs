// Workers KV over the REST API. Keys are URL-encoded (namespace created with supports_url_encoding).
// Limits enforced before sending: key ≤ 512 bytes, value ≤ 25 MiB, bulk ≤ 10,000 pairs and ≤ 90 MB body.
import { cloudflareApi, mapLimit } from './cf-api.mjs';

export const KV_LIMITS = Object.freeze({ key: 512, value: 25 * 1024 * 1024, bulkPairs: 10000, bulkBytes: 90 * 1024 * 1024, listPage: 1000 });

export function kvStore({ accountId, apiToken, namespaceId, ...options }) {
  if (!/^[a-f0-9]{32}$/.test(namespaceId ?? '')) throw new Error('Invalid KV namespace ID');
  const api = cloudflareApi({ accountId, apiToken, ...options });
  const ns = `/storage/kv/namespaces/${namespaceId}`;
  const checkKey = key => { if (typeof key !== 'string' || !key || Buffer.byteLength(key) > KV_LIMITS.key) throw new Error(`KV key invalid or exceeds ${KV_LIMITS.key} bytes`); return key; };
  const checkValue = bytes => { if (!Buffer.isBuffer(bytes)) throw new Error('KV value must be a Buffer'); if (bytes.length > KV_LIMITS.value) throw new Error('KV value exceeds 25 MiB'); return bytes; };
  const bulk = async (entries, retriesLeft = 3) => {
    const response = await api.request('PUT', `${ns}/bulk`, { body: JSON.stringify(entries.map(e => ({ key: e.key, value: e.bytes.toString('base64'), base64: true }))), headers: { 'content-type': 'application/json' } });
    const json = await response.json();
    const failed = json?.result?.unsuccessful_keys ?? [];
    if (!json?.success || failed.length) {
      const retry = entries.filter(e => failed.includes(e.key));
      if (json?.success && retry.length && retriesLeft > 0) return bulk(retry, retriesLeft - 1);
      throw new Error(`KV bulk write failed for ${failed.length || entries.length} keys`);
    }
  };
  return {
    kind: 'kv',
    async list(prefix) {
      const names = []; let cursor;
      for (;;) {
        const params = new URLSearchParams({ prefix, limit: String(KV_LIMITS.listPage) }); if (cursor) params.set('cursor', cursor);
        const json = await (await api.request('GET', `${ns}/keys?${params}`)).json();
        if (!json?.success) throw new Error('KV list failed');
        for (const entry of json.result) names.push(entry.name);
        cursor = json.result_info?.cursor; if (!cursor) return names;
      }
    },
    async get(key, max = KV_LIMITS.value) {
      const response = await api.request('GET', `${ns}/values/${encodeURIComponent(checkKey(key))}`, { expect: [200, 404] });
      if (response.status === 404) { await response.arrayBuffer().catch(() => {}); return null; }
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > max) throw new Error('KV object exceeds limit');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > max) throw new Error('KV object exceeds limit');
      return bytes;
    },
    async put(key, bytes) {
      await api.request('PUT', `${ns}/values/${encodeURIComponent(checkKey(key))}`, { body: checkValue(bytes), headers: { 'content-type': 'application/octet-stream' } });
    },
    async bulkPut(entries) {
      const batches = []; let batch = [], bytes = 0;
      for (const e of entries) {
        checkKey(e.key); checkValue(e.bytes);
        const cost = Math.ceil(e.bytes.length * 4 / 3) + Buffer.byteLength(e.key) + 48;
        if (batch.length && (batch.length >= KV_LIMITS.bulkPairs || bytes + cost > KV_LIMITS.bulkBytes)) { batches.push(batch); batch = []; bytes = 0; }
        batch.push(e); bytes += cost;
      }
      if (batch.length) batches.push(batch);
      for (const b of batches) await bulk(b);
      return batches.length;
    },
    async delete(keys, retriesLeft = 3) {
      const failed = [];
      for (let i = 0; i < keys.length; i += KV_LIMITS.bulkPairs) {
        const slice = keys.slice(i, i + KV_LIMITS.bulkPairs).map(checkKey);
        const json = await (await api.request('POST', `${ns}/bulk/delete`, { body: JSON.stringify(slice), headers: { 'content-type': 'application/json' } })).json();
        if (!json?.success) throw new Error('KV bulk delete failed');
        failed.push(...(json.result?.unsuccessful_keys ?? []));
      }
      if (failed.length) { if (retriesLeft > 0) return this.delete(failed, retriesLeft - 1); throw new Error(`KV bulk delete failed for ${failed.length} keys`); }
    },
    /**
     * Deletes are eventually consistent even for point reads (observed 2026-11-04: values stay readable
     * for a while after a successful bulk delete). Poll until every key reads as absent or the deadline
     * passes; returns true or the keys still present.
     */
    async absent(keys, { concurrency = 25, timeoutMs = 120000, intervalMs = 10000, sleep: wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
      let pending = [...keys];
      const started = Date.now();
      for (;;) {
        const present = [];
        await mapLimit(pending, concurrency, async key => { if (await this.get(key, KV_LIMITS.value)) present.push(key); });
        if (!present.length) return true;
        if (Date.now() - started >= timeoutMs) return present;
        pending = present; await wait(intervalMs);
      }
    },
    close() {},
  };
}
