import { execFileSync } from 'node:child_process';

// Branches own their buckets; neither workflow inputs nor secrets can override this map.
const buckets=Object.freeze({preview:'preview-cscheap-docs',master:'cscheap-docs'});
export function publicationTarget(env=process.env) {
  const branch=env.GITHUB_REF?.replace(/^refs\/heads\//,'');
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='cscheap/docs'||
    env.GITHUB_REF!==`refs/heads/${branch}`||!Object.hasOwn(buckets,branch)) {
    throw new Error('Publishing is restricted to the serialized preview/master workflows');
  }
  return {branch,bucket:buckets[branch]};
}

export function refreshPublicationHead(branch,cwd=process.cwd()) {
  if(!Object.hasOwn(buckets,branch))throw new Error('Invalid publication branch');
  const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe']}).trim();
  const remoteRef=`refs/remotes/origin/${branch}`;
  // An explicit refspec updates the right tracking ref even in a narrow Actions checkout.
  git('fetch','--no-tags','origin',`+refs/heads/${branch}:${remoteRef}`);
  return git('rev-parse',remoteRef);
}
