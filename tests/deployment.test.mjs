import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

import { validateTarget } from '../scripts/r2-store.mjs';

test('publisher rejects non-master execution before contacting services',()=>{
  for(const env of [
    {GITHUB_ACTIONS:'false'},
    {GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'cscheap/docs',GITHUB_REF:'refs/heads/other'},
  ]){
    const run=spawnSync(process.execPath,['scripts/publish.mjs'],{env:{...process.env,...env},encoding:'utf8'});
    assert.equal(run.status,1);assert.match(run.stderr,/serialized master/);
  }
});
test('shared R2 credentials cannot select the other deployment environment bucket',()=>{
  for(const [environment,bucket] of [['staging','preview-cscheap-docs'],['prod','cscheap-docs']]){
    assert.doesNotThrow(()=>validateTarget({CSCHEAP_DOCS_ENVIRONMENT:environment,CSCHEAP_DOCS_R2_BUCKET:bucket}));
    assert.throws(()=>validateTarget({CSCHEAP_DOCS_ENVIRONMENT:environment,CSCHEAP_DOCS_R2_BUCKET:bucket==='cscheap-docs'?'preview-cscheap-docs':'cscheap-docs'}),/does not match/);
  }
  assert.throws(()=>validateTarget({CSCHEAP_DOCS_ENVIRONMENT:'dev'}),/Invalid deployment environment/);
});
test('validation cannot request secrets and both deployment environments share the writer lock',()=>{
  const workflow=parse(readFileSync('.github/workflows/docs.yml','utf8'));
  assert.deepEqual(workflow.permissions,{contents:'read'});
  assert.equal(workflow.jobs.validate.permissions,undefined);
  assert.ok(!workflow.jobs.validate.steps.some(s=>String(s.run).includes('with-secrets')));
  const job=workflow.jobs.activate;
  assert.equal(job.needs,'validate');assert.deepEqual(job.permissions,{contents:'read'});
  assert.equal(job.env.CSCHEAP_DOCS_R2_ACCESS_KEY_ID,'${{ secrets.CSCHEAP_DOCS_R2_ACCESS_KEY_ID }}');
  assert.equal(job.env.CSCHEAP_DOCS_R2_SECRET_ACCESS_KEY,'${{ secrets.CSCHEAP_DOCS_R2_SECRET_ACCESS_KEY }}');
  assert.equal(workflow.jobs.validate.env,undefined);
  assert.equal(job.concurrency.group,'cscheap-docs-activation');assert.equal(job.concurrency['cancel-in-progress'],false);
  assert.match(job.if,/github.ref == 'refs\/heads\/master'/);
  assert.match(job.if,/github.event_name == 'workflow_dispatch' \|\| vars.CSCHEAP_DOCS_PUBLISH_ENABLED == 'true'/);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.environment.options,['production','staging']);
});
