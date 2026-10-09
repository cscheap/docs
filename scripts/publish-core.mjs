import { Bundle, Pointer, Published, Digest, LIMITS } from '../contracts/schema.ts';
import { digest, encode } from './compile.mjs';

export function decode(bytes, schema, max) {
  if(!bytes||bytes.length>max)throw new Error('Missing or oversized object');
  return schema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
}
export function verifyBundle(bytes, expected) {
  if(digest(bytes)!==expected)throw new Error('Bundle digest mismatch');
  const bundle=decode(bytes,Bundle,LIMITS.bundle);
  if(bundle.docsCommit==='0'.repeat(40))throw new Error('A local preview cannot be published');
  if(Object.values(bundle.baselines).some(b=>b.documentationReview!=='reviewed'))throw new Error('Unreviewed baseline');
  for(const p of bundle.pages)if(encode(p).length>LIMITS.page)throw new Error('Oversized page');
  return bundle;
}
export async function immutable(store,key,bytes,mime) {
  const old=await store.get(key,Math.max(bytes.length,1));
  if(old && !old.equals(bytes))throw new Error(`Immutable object differs: ${key}`);
  if(!old)await store.put(key,bytes,mime,'public, max-age=31536000, immutable');
  const readback=await store.get(key,bytes.length);
  if(!readback||!readback.equals(bytes))throw new Error(`Readback verification failed: ${key}`);
}
export async function readPointer(store) {
  const bytes=await store.get('channels/current.json',LIMITS.pointer);
  return {bytes,pointer:bytes?decode(bytes,Pointer,LIMITS.pointer):null};
}
export async function admit(store,releaseId,pointer) {
  Digest.parse(releaseId);
  const inPointer=[pointer?.current,pointer?.previous].find(r=>r?.releaseId===releaseId);
  if(inPointer)return inPointer;
  const bytes=await store.get(`published/${releaseId}.json`,LIMITS.pointer);
  if(!bytes)return null;
  const record=decode(bytes,Published,LIMITS.pointer);
  if(record.releaseId!==releaseId)throw new Error('Published record identity mismatch');
  return {releaseId,docsCommit:record.docsCommit};
}
async function marker(store,ref) {
  if(ref)await immutable(store,`published/${ref.releaseId}.json`,encode({schemaVersion:1,...ref}),'application/json');
}
async function verifyAssets(store,bundle) {
  for(const asset of Object.values(bundle.assets)) {
    const bytes=await store.get(asset.key,asset.size);
    if(!bytes||bytes.length!==asset.size||digest(bytes)!==asset.sha256)throw new Error(`Asset verification failed: ${asset.key}`);
  }
}
/** One serialized writer only. GitHub concurrency is the lock, not object storage. */
export async function activate({store,bytes,releaseId,assetBytes=new Map(),mode='publish',head,isAncestor,now=()=>new Date().toISOString()}) {
  Digest.parse(releaseId);
  if(!['publish','rollback'].includes(mode))throw new Error('Invalid activation mode');
  const bundle=verifyBundle(bytes,releaseId),ref={releaseId,docsCommit:bundle.docsCommit};
  const before=await readPointer(store);
  if(mode==='publish') {
    if(await head()!==bundle.docsCommit)return {status:'skipped-stale',releaseId};
    if(before.pointer && !await isAncestor(before.pointer.current.docsCommit,bundle.docsCommit))throw new Error('Publication must descend from current docs commit');
    for(const asset of Object.values(bundle.assets)) {
      const source=assetBytes.get(asset.key);
      if(!source||source.length!==asset.size||digest(source)!==asset.sha256)throw new Error('Build asset mismatch');
      await immutable(store,asset.key,source,asset.mime);
    }
    await immutable(store,`releases/${releaseId}/bundle.json`,bytes,'application/json');
  } else {
    const known=await admit(store,releaseId,before.pointer);
    if(!known||known.docsCommit!==bundle.docsCommit)throw new Error('Rollback requires a previously published release');
    const stored=await store.get(`releases/${releaseId}/bundle.json`,LIMITS.bundle);
    if(!stored||!stored.equals(bytes))throw new Error('Rollback bundle missing or changed');
  }
  await verifyAssets(store,bundle);
  // Repair records BEFORE moving either pointer reference out of current/previous.
  await marker(store,before.pointer?.current);
  await marker(store,before.pointer?.previous);
  if(mode==='publish'&&await head()!==bundle.docsCommit)return {status:'skipped-stale',releaseId};
  const latest=await readPointer(store);
  if(!((!before.bytes&&!latest.bytes)||(before.bytes&&latest.bytes&&before.bytes.equals(latest.bytes))))throw new Error('Pointer changed: another writer exists');
  if(before.pointer?.current.releaseId===releaseId) {
    await marker(store,ref);return {status:'already-current',releaseId};
  }
  const pointer=Pointer.parse({schemaVersion:1,current:ref,previous:before.pointer?.current??null,activatedAt:now()});
  await store.put('channels/current.json',encode(pointer),'application/json','no-store');
  const after=await readPointer(store);
  if(!after.bytes?.equals(encode(pointer)))throw new Error('Activation readback mismatch');
  // If this fails, current is already activated. The next run repairs its marker.
  await marker(store,ref);
  return {status:mode==='rollback'?'rolled-back':'published',releaseId,docsCommit:bundle.docsCommit};
}
