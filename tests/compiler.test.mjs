import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, writeFile, readFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile, syntaxCheck, digest, encode } from '../scripts/compile.mjs';
import { Bundle, safeUrl } from '../contracts/schema.ts';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticTinaMarkdown } from 'tinacms/dist/rich-text/static';
import ts from 'typescript';
import vm from 'node:vm';

const root=process.cwd();
async function fixture(run) {
  const dir=await mkdtemp(join(tmpdir(),'cscheap-docs-test-'));
  try {
    for(const path of ['baselines','tina','contracts','navigation.json','redirects.json','assets'])await cp(join(root,path),join(dir,path),{recursive:true});
    for(const locale of ['en','zh-CN','ru'])await mkdir(join(dir,'content',locale,'get-started'),{recursive:true});
    await writeFile(join(dir,'navigation.json'),JSON.stringify({schemaVersion:1,groups:[{title:{en:'Start','zh-CN':'开始',ru:'Начало'},pages:['get-started/introduction']}]}));
    for(const locale of ['en','zh-CN','ru'])await cp(join(root,'content',locale,'get-started/introduction.mdx'),join(dir,'content',locale,'get-started/introduction.mdx'));
    // Independent minimal fixture: eliminate links to pages not included here.
    for(const locale of ['en','zh-CN','ru']){
      const p=join(dir,'content',locale,'get-started/introduction.mdx');let text=await readFile(p,'utf8');
      text=text.slice(0,text.indexOf('\n---\n')+5)+'\n## Same `heading`\n\nAlpha text.\n\n## Same heading\n\n[Anchor](#same-heading-1)\n\n<Callout type="info">\n\n## 中文 Русский\n\nCallout body.\n\n</Callout>\n';
      if(locale!=='en')text=text.replace(/sourceDigest: .*/,`sourceDigest: "sha256:${digest(await readFile(join(dir,'content/en/get-started/introduction.mdx')))}"`);
      await writeFile(p,text);
    }
    await run(dir);
  }finally{await rm(dir,{recursive:true,force:true});}
}

test('full 147-page trilingual corpus compiles deterministically and fits release limits',async()=>{
  const a=await compile(),b=await compile();
  assert.equal(a.bundle.pages.length,147);assert.equal(a.assetBytes.size,3);
  assert.ok(a.bytes.equals(b.bytes));assert.equal(a.warnings.length,0);Bundle.parse(a.bundle);
  for(const locale of ['en','zh-CN','ru'])assert.equal(a.bundle.pages.filter(p=>p.locale===locale).length,49);
  const components=Object.fromEntries(['h2','h3','h4','h5','h6'].map(tag=>[tag,props=>React.createElement(tag,{id:props.id},props.children)]));
  for(const page of a.bundle.pages){
    const html=renderToStaticMarkup(React.createElement(StaticTinaMarkdown,{content:page.body,components}));
    assert.ok(html.includes('<h2'),page.slug);
    for(const h of page.toc)assert.ok(html.includes(`id="${h.url.slice(1)}"`),`${page.slug}: ${h.url}`);
  }
});
test('repeated, inline-code, Chinese/Russian and nested Callout headings share stable TOC ids',async()=>fixture(async dir=>{
  const {bundle}=await compile({root:dir});
  assert.deepEqual(bundle.pages[0].toc.map(x=>x.url),['#same-heading','#same-heading-1','#中文-русский']);
  assert.ok(bundle.search.en.some(r=>r.url.endsWith('#中文-русский')));
}));
test('English edits exclude stale translations from pages, trees, search and language map',async()=>fixture(async dir=>{
  const path=join(dir,'content/en/get-started/introduction.mdx');await writeFile(path,(await readFile(path,'utf8')).replace('Alpha text.','New facts.'));
  const {bundle,warnings}=await compile({root:dir});
  assert.equal(bundle.pages.length,1);assert.equal(warnings.length,2);assert.equal(bundle.trees.ru.length,0);assert.equal(bundle.search.ru.length,0);
  assert.deepEqual(Object.keys(bundle.translations['get-started.introduction']),['en']);
}));
test('drafts and assets referenced only by drafts are excluded',async()=>fixture(async dir=>{
  await mkdir(join(dir,'content/en/drafts'));await writeFile(join(dir,'content/en/drafts/secret.mdx'),'---\ndocId: draft.secret\ntitle: Secret\ndescription: Secret\nkind: reference\nstatus: draft\nsources: [api]\n---\n\n## Draft\n\n[Asset](/assets/not-present.json)\n');
  const {bundle}=await compile({root:dir});assert.equal(bundle.pages.length,3);assert.deepEqual(bundle.assets,{});
}));
for(const source of ['export const secret = 1','Hello {process.env.TOKEN}','<script>alert(1)</script>','<Unknown />','<Callout type={"info"}>x</Callout>','<Callout type="info" onClick="x">x</Callout>','[bad](javascript:alert)','![external](https://example.com/image.png)','# Duplicate H1','- [x] task'])
  test(`reject unsupported source: ${source}`,()=>assert.throws(()=>syntaxCheck(source)));
test('dangerous URLs including encoded controls and scheme-relative links are rejected',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,x','//evil.test','/docs/%2e%2e/private','/docs/%0aevil','https://user:pass@example.com','/docs/\\evil'])assert.equal(safeUrl(url),false,url);
  for(const url of ['/docs/api/overview','#中文','https://cs.cheap/en','mailto:help@example.com'])assert.equal(safeUrl(url),true,url);
});
test('broken links and anchors fail compilation',async()=>fixture(async dir=>{
  const p=join(dir,'content/en/get-started/introduction.mdx');await writeFile(p,(await readFile(p,'utf8')).replace('#same-heading-1','#missing'));await assert.rejects(compile({root:dir}),/Broken anchor/);
}));
test('pending baseline prevents publication input',async()=>fixture(async dir=>{
  const p=join(dir,'baselines/api.json');const value=JSON.parse(await readFile(p));value.documentationReview='pending';await writeFile(p,JSON.stringify(value));await assert.rejects(compile({root:dir}),/Unreviewed/);
}));
test('unregistered AST props are rejected at the runtime contract boundary',async()=>fixture(async dir=>{
  const {bundle}=await compile({root:dir});bundle.pages[0].body.children[0].onClick='alert(1)';assert.equal(Bundle.safeParse(bundle).success,false);
}));
test('symlink content cannot import files from outside the repository',async()=>fixture(async dir=>{
  await symlink('/etc/passwd',join(dir,'content/en/get-started/outside.mdx'));await assert.rejects(compile({root:dir}),/Symlink/);
}));
test('redirect chains and dangling targets cannot enter a release',async()=>fixture(async dir=>{
  await writeFile(join(dir,'redirects.json'),JSON.stringify([{locale:'en',from:'old',to:'missing',toLocale:'en',status:'308'}]));await assert.rejects(compile({root:dir}),/Dangling redirect/);
}));
test('reference-style images cannot bypass repository asset restrictions',async()=>fixture(async dir=>{
  const p=join(dir,'content/en/get-started/introduction.mdx');await writeFile(p,(await readFile(p,'utf8'))+'\n![external][image]\n\n[image]: https://example.com/image.png\n');
  await assert.rejects(compile({root:dir}));
}));
test('byte order is stable regardless of object property insertion order',()=>assert.ok(encode({b:1,a:2}).equals(encode({a:2,b:1}))));
test('Tina config fields and compiler lock agree without loading the browser editor package',async()=>{
  const source=await readFile('tina/config.ts','utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const sandbox={exports:{},process:{env:{}},require:name=>{assert.equal(name,'tinacms');return {defineConfig:value=>value};}};
  vm.runInNewContext(js,sandbox,{timeout:1000});
  const lock=JSON.parse(await readFile('tina/tina-lock.json','utf8'));
  const fields=new Set(['name','path','format','fields','templates','type','list','required','isBody','isTitle','options']);
  const projection=v=>Array.isArray(v)?v.map(projection):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).filter(k=>fields.has(k)).sort().map(k=>[k,projection(v[k])])):v;
  assert.equal(JSON.stringify(projection(sandbox.exports.default.schema.collections)),JSON.stringify(projection(lock.schema.collections)));
});
