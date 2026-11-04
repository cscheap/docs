// Minimal Cloudflare REST client shared by the KV and R2 stores: bearer auth, per-request timeout,
// bounded retries on 429 / 5xx / network failures (Retry-After honoured), no SDK dependency.
export const API_BASE = 'https://api.cloudflare.com/client/v4';
export const RETRY_DELAYS_MS = [1000, 2000, 4000];

export function cloudflareApi({ accountId, apiToken, fetch: fetchImpl = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), timeoutMs = 30000, retryDelays = RETRY_DELAYS_MS }) {
  if (!/^[a-f0-9]{32}$/.test(accountId ?? '')) throw new Error('Invalid Cloudflare account ID');
  if (!apiToken) throw new Error('Missing Cloudflare API token');
  const base = `${API_BASE}/accounts/${accountId}`;
  async function request(method, path, { body, headers = {}, expect = [200] } = {}) {
    let attempt = 0;
    for (;;) {
      let response;
      try {
        response = await fetchImpl(`${base}${path}`, { method, headers: { authorization: `Bearer ${apiToken}`, ...headers }, body, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        if (attempt < retryDelays.length) { await sleep(retryDelays[attempt]); attempt += 1; continue; }
        throw new Error(`Cloudflare API ${method} ${path} failed: ${error.name}`);
      }
      if (expect.includes(response.status)) return response;
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < retryDelays.length) {
        const after = Number(response.headers.get('retry-after'));
        await response.arrayBuffer().catch(() => {});
        await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : retryDelays[attempt]);
        attempt += 1; continue;
      }
      const text = await response.text().catch(() => '');
      throw new Error(`Cloudflare API ${method} ${path} → ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
    }
  }
  return { request, base };
}

/** Bounded-concurrency map preserving order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  async function worker() { for (;;) { const i = next; next += 1; if (i >= items.length) return; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
