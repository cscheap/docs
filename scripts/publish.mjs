import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { r2Store, validateTarget } from './r2-store.mjs';
import { activate, verifyBundle } from './publish-core.mjs';
import { Digest, LIMITS } from '../contracts/schema.ts';
import { digest } from './compile.mjs';

let store;
try {
  // Deliberately no direct laptop publishing bypass: all writers share the workflow lock.
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='cscheap/docs'||process.env.GITHUB_REF!=='refs/heads/master')throw new Error('Publishing is restricted to the serialized master workflow');
  const git=(...args)=>execFileSync('git',args,{encoding:'utf8',timeout:20000}).trim();
  if(git('status','--porcelain'))throw new Error('Publishing requires a clean checkout');
  const mode=process.env.DOCS_PUBLISH_MODE||'publish';
  validateTarget();
  store=r2Store();
  let bytes,releaseId;
  if(mode==='rollback'){
    releaseId=Digest.parse(process.env.DOCS_ROLLBACK_RELEASE);
    bytes=await store.get(`releases/${releaseId}/bundle.json`,LIMITS.bundle);
    if(!bytes)throw new Error('Rollback release does not exist');
  }else{
    bytes=await readFile('dist/bundle.json');releaseId=digest(bytes);
    const build=JSON.parse(await readFile('dist/build.json','utf8'));
    if(build.preview||build.releaseId!==releaseId||build.docsCommit!==git('rev-parse','HEAD'))throw new Error('Release build provenance mismatch');
  }
  const bundle=verifyBundle(bytes,releaseId),assetBytes=new Map();
  if(mode==='publish')for(const asset of Object.values(bundle.assets))assetBytes.set(asset.key,await readFile(`dist/${asset.key}`));
  const result=await activate({store,bytes,releaseId,assetBytes,mode,
    head:async()=>{
      git('fetch','--no-tags','origin','master');
      return git('rev-parse','refs/remotes/origin/master');
    },
    isAncestor:async(before,after)=>{try{git('merge-base','--is-ancestor',before,after);return true;}catch{return false;}},
  });
  console.log(JSON.stringify(result));
}catch(error){console.error(error instanceof Error?error.message.slice(0,1000):'Publication failed');process.exitCode=1;}
finally{store?.close();}
