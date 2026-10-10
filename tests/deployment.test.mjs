import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { publicationTarget, refreshPublicationHead } from '../scripts/deployment.mjs';

const context={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'cscheap/docs'};
test('publisher rejects local, foreign repository, PR, tag and other branch execution before contacting services',()=>{
  for(const env of [
    {...context,GITHUB_ACTIONS:'false',GITHUB_REF:'refs/heads/master'},
    {...context,GITHUB_REPOSITORY:'other/docs',GITHUB_REF:'refs/heads/preview'},
    ...['refs/heads/other','refs/tags/master','refs/pull/1/merge','preview','refs/heads/toString',''].map(GITHUB_REF=>({...context,GITHUB_REF})),
  ]){
    const run=spawnSync(process.execPath,['scripts/publish.mjs'],{env:{...process.env,...env},encoding:'utf8'});
    assert.equal(run.status,1);assert.match(run.stderr,/serialized preview\/master/);
  }
});
test('branch determines bucket even when obsolete environment overrides are present',()=>{
  for(const [branch,bucket] of [['preview','preview-cscheap-docs'],['master','cscheap-docs']]){
    assert.deepEqual(publicationTarget({...context,GITHUB_REF:`refs/heads/${branch}`,
      CSCHEAP_DOCS_ENVIRONMENT:branch==='preview'?'prod':'staging',
      CSCHEAP_DOCS_R2_BUCKET:bucket==='cscheap-docs'?'preview-cscheap-docs':'cscheap-docs',
    }),{branch,bucket});
  }
});
test('fresh head follows the selected remote branch, including updates outside a narrow fetch configuration',t=>{
  const cwd=mkdtempSync(join(tmpdir(),'docs-branches-'));
  t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','--bare','origin.git');git('init','-b','master','source');
  const source=(...args)=>git('-C','source',...args);
  source('config','user.name','Docs test');source('config','user.email','docs-test@example.invalid');
  source('commit','--allow-empty','-m','base');
  const master=source('rev-parse','HEAD');
  source('remote','add','origin','../origin.git');source('push','origin','master');
  source('switch','-c','preview');source('commit','--allow-empty','-m','preview one');
  source('push','origin','preview');
  git('clone','--single-branch','--branch','master','origin.git','runner');
  const runner=join(cwd,'runner');
  assert.equal(refreshPublicationHead('preview',runner),source('rev-parse','HEAD'));
  assert.equal(refreshPublicationHead('master',runner),master);
  source('commit','--allow-empty','-m','preview two');source('push','origin','preview');
  assert.equal(refreshPublicationHead('preview',runner),source('rev-parse','HEAD'));
  assert.equal(refreshPublicationHead('master',runner),master);
  assert.throws(()=>refreshPublicationHead('other',runner),/Invalid publication branch/);
});
test('both push branches publish with three repository secrets and a separate writer lock per bucket',()=>{
  const workflow=parse(readFileSync('.github/workflows/docs.yml','utf8'));
  assert.deepEqual(workflow.on.push.branches,['preview','master']);
  assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs),['mode','release']);
  assert.deepEqual(workflow.permissions,{contents:'read'});
  assert.equal(workflow.jobs.validate.permissions,undefined);
  assert.equal(workflow.jobs.validate.env,undefined);
  assert.ok(!JSON.stringify(workflow.jobs.validate).includes('secrets.'));
  const job=workflow.jobs.activate;
  assert.equal(job.needs,'validate');assert.deepEqual(job.permissions,{contents:'read'});
  for(const name of ['CSCHEAP_DOCS_R2_ACCOUNT_ID','CSCHEAP_DOCS_R2_ACCESS_KEY_ID','CSCHEAP_DOCS_R2_SECRET_ACCESS_KEY']){
    assert.equal(job.env[name],'${{ secrets.'+name+' }}');
  }
  assert.equal(job.environment,undefined);
  assert.equal(job.env.CSCHEAP_DOCS_ENVIRONMENT,undefined);
  assert.equal(job.env.CSCHEAP_DOCS_R2_BUCKET,undefined);
  assert.ok(!JSON.stringify(workflow).includes('vars.'));
  assert.equal(job.concurrency.group,'cscheap-docs-activation-${{ github.ref_name }}');
  assert.equal(job.concurrency['cancel-in-progress'],false);
  assert.equal(job.if,"(github.event_name == 'push' || github.event_name == 'workflow_dispatch') && (github.ref == 'refs/heads/preview' || github.ref == 'refs/heads/master')");
});
