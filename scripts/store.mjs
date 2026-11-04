// Store composition. Entry points decide *whether* they may publish (Actions guard or test-prefix
// guard) and then call openStores(); the activation algorithm only sees get/list/put/bulkPut/delete.
import { kvStore } from './kv-store.mjs';
import { r2Store } from './r2-store.mjs';

/** Wraps a store so every key carries `prefix`; list() returns keys with the prefix stripped. */
export function prefixed(store, prefix) {
  if (!prefix) return store;
  const add = key => prefix + key, strip = key => { if (!key.startsWith(prefix)) throw new Error('Listed key outside prefix'); return key.slice(prefix.length); };
  return {
    kind: store.kind,
    list: async p => (await store.list(add(p))).map(strip),
    get: (key, max) => store.get(add(key), max),
    put: (key, bytes, mime) => store.put(add(key), bytes, mime),
    bulkPut: store.bulkPut ? entries => store.bulkPut(entries.map(e => ({ ...e, key: add(e.key) }))) : undefined,
    delete: keys => store.delete(keys.map(add)),
    absent: store.absent ? async (keys, options) => { const r = await store.absent(keys.map(add), options); return r === true ? true : r.map(strip); } : undefined,
    close: () => store.close?.(),
  };
}

export function openStores({ accountId, apiToken, namespaceId, bucket, prefix = '', ...options }) {
  const kv = prefixed(kvStore({ accountId, apiToken, namespaceId, ...options }), prefix);
  const r2 = prefixed(r2Store({ accountId, apiToken, bucket, ...options }), prefix);
  return { kv, r2, close() { kv.close(); r2.close(); } };
}

/** In-memory store for tests: same interface, with hooks for injected failures and stale reads. */
export function memoryStore(kind = 'kv') {
  const objects = new Map();
  const store = {
    kind, objects, failPut: null, failGet: null, staleReads: new Map(), history: new Map(), writes: [],
    async list(prefix) { return [...objects.keys()].filter(k => k.startsWith(prefix)).sort(); },
    async get(key, max = Infinity) {
      if (store.failGet?.(key)) throw new Error(`Injected read failure: ${key}`);
      const stale = store.staleReads.get(key);
      if (stale && stale.remaining !== 0) { if (stale.remaining > 0) stale.remaining -= 1; return stale.value === undefined ? null : Buffer.from(stale.value); }
      const v = objects.get(key); if (v && v.length > max) throw new Error('Object exceeds limit');
      return v ? Buffer.from(v) : null;
    },
    async put(key, bytes) {
      if (store.failPut?.(key)) throw new Error(`Injected write failure: ${key}`);
      store.writes.push(key); objects.set(key, Buffer.from(bytes));
    },
    async bulkPut(entries) { for (const e of entries) await store.put(e.key, e.bytes); return 1; },
    async delete(keys) { for (const k of keys) objects.delete(k); },
    close() {},
    /** Make the next `times` reads of `key` return `value` (undefined = missing) instead of the stored bytes; -1 = forever. */
    stale(key, value, times = -1) { store.staleReads.set(key, { value, remaining: times }); },
  };
  return store;
}
