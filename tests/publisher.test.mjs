import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, digest, encode } from '../scripts/compile.mjs';
import { activate, admit, readPointer, verifyBundle, decode } from '../scripts/publish-core.mjs';
import { Pointer, LIMITS } from '../contracts/schema.ts';

const source=await compile();
function release(n){const bundle={...source.bundle,docsCommit:String(n).repeat(40)};const bytes=encode(bundle);return{bundle,bytes,releaseId:digest(bytes),assetBytes:source.assetBytes};}
function memory(){const objects=new Map();return{objects,fail:null,async get(key,max){const v=objects.get(key);if(v&&v.length>max)throw new Error('Object exceeds limit');return v?Buffer.from(v):null;},async put(key,bytes){if(this.fail?.(key))throw new Error('Injected write failure');objects.set(key,Buffer.from(bytes));}};}
const stamp=()=> '2026-10-09T00:00:00.000Z';
async function publish(store,r,extra={}){return activate({store,...r,head:async()=>r.bundle.docsCommit,isAncestor:async(a,b)=>a<=b,now:stamp,...extra});}

test('R1 → R2 → R3 retains admission and bytes for the oldest published release',async()=>{
  const store=memory(),[r1,r2,r3]=[1,2,3].map(release);
  for(const r of [r1,r2,r3])await publish(store,r);
  const {pointer}=await readPointer(store);assert.equal(pointer.current.releaseId,r3.releaseId);assert.equal(pointer.previous.releaseId,r2.releaseId);
  assert.equal((await admit(store,r1.releaseId,pointer)).docsCommit,r1.bundle.docsCommit);
  assert.ok(store.objects.get(`releases/${r1.releaseId}/bundle.json`).equals(r1.bytes));
});
test('stale queued publication is skipped without moving current',async()=>{
  const store=memory(),r1=release(1),r2=release(2);await publish(store,r2);
  const result=await publish(store,r1,{head:async()=>r2.bundle.docsCommit});assert.equal(result.status,'skipped-stale');assert.equal((await readPointer(store)).pointer.current.releaseId,r2.releaseId);
});
test('a new master appearing during upload prevents activation of an older event',async()=>{
  const store=memory(),r1=release(1),r2=release(2);await publish(store,r1);let count=0;
  assert.equal((await publish(store,r2,{head:async()=>++count===1?r2.bundle.docsCommit:'3'.repeat(40)})).status,'skipped-stale');
  const {pointer}=await readPointer(store);assert.equal(pointer.current.releaseId,r1.releaseId);assert.equal(await admit(store,r2.releaseId,pointer),null);
});
test('non-descendant publication is rejected even when it is the remote head',async()=>{
  const store=memory();await publish(store,release(2));await assert.rejects(publish(store,release(1)),/descend/);
});
test('asset or bundle upload failure leaves old pointer intact',async()=>{
  const store=memory(),r1=release(1),r2=release(2);await publish(store,r1);const before=store.objects.get('channels/current.json');
  store.fail=key=>key===`releases/${r2.releaseId}/bundle.json`;await assert.rejects(publish(store,r2),/Injected/);assert.ok(store.objects.get('channels/current.json').equals(before));
});
test('post-activation marker failure is repaired before the release leaves the pointer',async()=>{
  const store=memory(),[r1,r2,r3]=[1,2,3].map(release);
  store.fail=key=>key===`published/${r1.releaseId}.json`;await assert.rejects(publish(store,r1),/Injected/);
  assert.equal((await readPointer(store)).pointer.current.releaseId,r1.releaseId);
  store.fail=null;await publish(store,r2);await publish(store,r3);
  assert.ok(await admit(store,r1.releaseId,(await readPointer(store)).pointer));
});
test('rollback accepts known published releases and changes the whole pointer',async()=>{
  const store=memory(),r1=release(1),r2=release(2);await publish(store,r1);await publish(store,r2);
  const result=await publish(store,r1,{mode:'rollback'});assert.equal(result.status,'rolled-back');const {pointer}=await readPointer(store);assert.equal(pointer.current.releaseId,r1.releaseId);assert.equal(pointer.previous.releaseId,r2.releaseId);
});
test('a guessed, uploaded but unactivated release cannot be rolled back to',async()=>{
  const store=memory(),r=release(1);store.objects.set(`releases/${r.releaseId}/bundle.json`,r.bytes);await assert.rejects(publish(store,r,{mode:'rollback'}),/previously published/);
});
test('malformed or mismatched historical records fail closed',async()=>{
  const store=memory(),r=release(1);store.objects.set(`published/${r.releaseId}.json`,encode({schemaVersion:1,releaseId:release(2).releaseId,docsCommit:r.bundle.docsCommit}));await assert.rejects(admit(store,r.releaseId,null),/identity/);
  store.objects.set(`published/${r.releaseId}.json`,Buffer.from('{}'));await assert.rejects(admit(store,r.releaseId,null));
});
test('same release rerun is idempotent and keeps previous unchanged',async()=>{
  const store=memory(),r=release(1);await publish(store,r);const before=store.objects.get('channels/current.json');assert.equal((await publish(store,r)).status,'already-current');assert.ok(store.objects.get('channels/current.json').equals(before));
});
test('corrupt immutable object is never overwritten and pointer is untouched',async()=>{
  const store=memory(),r=release(1);store.objects.set(`releases/${r.releaseId}/bundle.json`,Buffer.from('corrupt'));await assert.rejects(publish(store,r),/Immutable/);assert.equal((await readPointer(store)).pointer,null);
});
test('preview commits, unknown schemas and changed bytes cannot be published',()=>{
  assert.throws(()=>verifyBundle(source.bytes,source.releaseId),/preview/);
  const r=release(1);assert.throws(()=>verifyBundle(Buffer.concat([r.bytes,Buffer.from(' ')]),r.releaseId),/digest/);
  const bytes=encode({...r.bundle,schemaVersion:2});assert.throws(()=>verifyBundle(bytes,digest(bytes)));
});
test('oversized pointer is rejected before JSON parsing',()=>assert.throws(()=>decode(Buffer.alloc(LIMITS.pointer+1),Pointer,LIMITS.pointer),/oversized/));
test('missing asset blocks rollback and cannot silently mix assets from another release',async()=>{
  const store=memory(),r1=release(1),r2=release(2);await publish(store,r1);await publish(store,r2);
  store.objects.delete(Object.values(r1.bundle.assets)[0].key);await assert.rejects(publish(store,r1,{mode:'rollback'}),/Asset verification/);
  assert.equal((await readPointer(store)).pointer.current.releaseId,r2.releaseId);
});
