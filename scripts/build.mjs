import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { compile, encode } from './compile.mjs';

const production=process.argv.includes('--release');
function git(...args){return execFileSync('git',args,{encoding:'utf8'}).trim();}
try {
  let docsCommit='0'.repeat(40);
  if(production){
    if(git('status','--porcelain'))throw new Error('Release builds require a clean, committed checkout');
    docsCommit=git('rev-parse','HEAD');
    if(process.env.GITHUB_SHA && process.env.GITHUB_SHA!==docsCommit)throw new Error('Checkout does not match workflow event SHA');
  }
  const result=await compile({docsCommit});
  await mkdir('dist/assets',{recursive:true});
  await writeFile('dist/bundle.json',result.bytes);
  for(const [key,bytes] of result.assetBytes){await mkdir(`dist/${key.slice(0,key.lastIndexOf('/'))}`,{recursive:true});await writeFile(`dist/${key}`,bytes);}
  await writeFile('dist/build.json',encode({preview:!production,releaseId:result.releaseId,docsCommit,pages:result.bundle.pages.length,bytes:result.bytes.length,warnings:result.warnings}));
  for(const warning of result.warnings)console.warn(warning);
  console.log(JSON.stringify({mode:production?'release':'local-preview',pages:result.bundle.pages.length,assets:result.assetBytes.size,bytes:result.bytes.length,releaseId:result.releaseId}));
}catch(error){console.error(error instanceof Error?error.message.slice(0,3000):'Build failed');process.exitCode=1;}
