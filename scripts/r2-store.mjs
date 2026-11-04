// R2 over the Cloudflare REST object API (same bearer token as KV; no S3 credentials, no SDK).
// Only binary assets live here: get / put / list / delete, nothing else.
import { cloudflareApi } from './cf-api.mjs';

const encodeKey = key => key.split('/').map(encodeURIComponent).join('/');

export function r2Store({ accountId, apiToken, bucket, ...options }) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket ?? '')) throw new Error('Invalid R2 bucket name');
  const api = cloudflareApi({ accountId, apiToken, ...options });
  const base = `/r2/buckets/${bucket}/objects`;
  return {
    kind: 'r2',
    async list(prefix) {
      const keys = []; let cursor;
      for (;;) {
        const params = new URLSearchParams({ prefix, per_page: '1000' }); if (cursor) params.set('cursor', cursor);
        const json = await (await api.request('GET', `${base}?${params}`)).json();
        if (!json?.success) throw new Error('R2 list failed');
        for (const entry of json.result) keys.push(entry.key);
        cursor = json.result_info?.is_truncated ? json.result_info.cursor : undefined; if (!cursor) return keys;
      }
    },
    async get(key, max) {
      const response = await api.request('GET', `${base}/${encodeKey(key)}`, { expect: [200, 404] });
      if (response.status === 404) { await response.arrayBuffer().catch(() => {}); return null; }
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > max) throw new Error('R2 object exceeds limit');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > max) throw new Error('R2 object exceeds limit');
      return bytes;
    },
    async put(key, bytes, mime = 'application/octet-stream') {
      await api.request('PUT', `${base}/${encodeKey(key)}`, { body: bytes, headers: { 'content-type': mime, 'cache-control': 'public, max-age=31536000, immutable' } });
    },
    async delete(keys) {
      for (const key of keys) await api.request('DELETE', `${base}/${encodeKey(key)}`, { expect: [200, 404] }).then(r => r.arrayBuffer().catch(() => {}));
    },
    close() {},
  };
}
