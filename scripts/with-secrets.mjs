import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Credentials stay in memory and the child environment; no .env or GITHUB_ENV output.
const domain='https://infisical.cscheap.com';
const projectId='18349aef-bd88-46ad-9346-38d4023c9209';
async function json(url,options={}){
  let response;
  try{response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});}
  catch{throw new Error('Secret service request failed');}
  if(!response.ok)throw new Error(`Secret service returned HTTP ${response.status}`);
  const parts=[];let size=0;
  for await(const part of response.body){size+=part.length;if(size>512*1024)throw new Error('Secret service response too large');parts.push(part);}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new Error('Secret service returned invalid JSON');}
}
const required=k=>{const v=process.env[k];if(!v)throw new Error(`Missing ${k}`);return v;};
const mask=value=>console.log(`::add-mask::${value.replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A')}`);
async function artifactScan(path,values){
  for(const entry of await readdir(path,{withFileTypes:true})){
    const child=resolve(path,entry.name);
    if(entry.isDirectory())await artifactScan(child,values);
    else {const bytes=await readFile(child);if(values.some(v=>v&&bytes.includes(Buffer.from(v))))throw new Error('A secret was found in the CMS build artifact; upload refused');}
  }
}
try{
  const mode=process.argv[2];
  if(!['publish','cms'].includes(mode))throw new Error('Use with-secrets.mjs publish|cms');
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='cscheap/docs'||process.env.GITHUB_REF!=='refs/heads/master')throw new Error('Secrets are restricted to trusted master workflows');
  const environment=required('CSCHEAP_DOCS_ENVIRONMENT');if(!['staging','prod'].includes(environment))throw new Error('Invalid deployment environment');
  const requestUrl=new URL(required('ACTIONS_ID_TOKEN_REQUEST_URL'));
  if(requestUrl.protocol!=='https:'||!requestUrl.hostname.endsWith('.actions.githubusercontent.com'))throw new Error('Unexpected GitHub OIDC request host');
  requestUrl.searchParams.set('audience','https://github.com/cscheap');
  const oidc=await json(requestUrl,{headers:{Authorization:`Bearer ${required('ACTIONS_ID_TOKEN_REQUEST_TOKEN')}`}});
  if(typeof oidc.value!=='string')throw new Error('Missing GitHub OIDC token');mask(oidc.value);
  const login=await json(`${domain}/api/v1/auth/oidc-auth/login`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({identityId:required('CSCHEAP_DOCS_INFISICAL_IDENTITY_ID'),jwt:oidc.value})});
  if(typeof login.accessToken!=='string')throw new Error('Missing Infisical access token');mask(login.accessToken);
  const keys=mode==='publish'?['CSCHEAP_DOCS_R2_ACCOUNT_ID','CSCHEAP_DOCS_R2_BUCKET','CSCHEAP_DOCS_R2_ACCESS_KEY_ID','CSCHEAP_DOCS_R2_SECRET_ACCESS_KEY']:['CSCHEAP_DOCS_TINA_CLIENT_ID','CSCHEAP_DOCS_TINA_READ_TOKEN'];
  const secrets={};
  for(const key of keys){
    const url=new URL(`${domain}/api/v4/secrets/${key}`);url.search=new URLSearchParams({projectId,environment,secretPath:'/cscheap/docs',type:'shared'});
    const result=await json(url,{headers:{Authorization:`Bearer ${login.accessToken}`}});
    const value=result.secret?.secretValue;if(typeof value!=='string'||!value.trim())throw new Error(`Missing or empty ${key}`);mask(value);secrets[key]=value;
  }
  const args=mode==='publish'?['scripts/publish.mjs']:['scripts/tina.mjs','build','--noTelemetry'];
  const code=await new Promise((ok,fail)=>{const child=spawn(process.execPath,args,{stdio:'inherit',env:{...process.env,...secrets}});child.on('error',()=>fail(new Error('Could not start build process')));child.on('exit',n=>ok(n??1));});
  if(code!==0)throw new Error(`${mode} process failed`);
  if(mode==='cms')await artifactScan('public/admin',[secrets.CSCHEAP_DOCS_TINA_READ_TOKEN,login.accessToken,oidc.value]);
}catch(error){console.error(error instanceof Error?error.message:'Credential injection failed');process.exitCode=1;}
