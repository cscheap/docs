import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, writeFile, readFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile, syntaxCheck, digest, encode } from '../scripts/compile.mjs';
import { Bundle, safeUrl } from '../contracts/schema.ts';
import { walk } from '../scripts/compile.mjs';
import { compileBody, themes } from '../scripts/mdx.mjs';
import { LIMITS } from '../contracts/schema.ts';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm';
import { remarkHeading, remarkStructure } from 'fumadocs-core/mdx-plugins';
import { codeToTokens } from 'shiki';

const root=process.cwd();
async function fixture(run) {
  const dir=await mkdtemp(join(tmpdir(),'cscheap-docs-test-'));
  try {
    for(const path of ['baselines','contracts','navigation.json','redirects.json','assets'])await cp(join(root,path),join(dir,path),{recursive:true});
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
  const independent=unified().use(remarkParse).use(remarkGfm).use(remarkMdx).use(remarkHeading).use(remarkStructure);
  let codeBlocks=0;const languages={};
  for(const page of a.bundle.pages){
    assert.ok(encode(page).length<=LIMITS.page);
    const source=(await readFile(join(root,'content',page.locale,page.slug+'.mdx'),'utf8')).split(/\n---\n/)[1];
    const file={data:{}};const syntax=await independent.run(independent.parse(source),file);
    assert.deepEqual(page.toc,file.data.toc,`${page.locale}/${page.slug}: heading IDs`);
    assert.deepEqual(JSON.parse(JSON.stringify(page.structuredData)),JSON.parse(JSON.stringify(file.data.structuredData)));
    const ids=[],blocks=[],original=[];
    walk(page.body,n=>{if(n.type==='element'&&/^h[2-6]$/.test(n.tagName))ids.push('#'+n.properties.id);if(n.type==='codeBlock')blocks.push(n);});
    walk(syntax,n=>{if(n.type==='code')original.push(n);});
    assert.deepEqual(ids,page.toc.map(h=>h.url));assert.equal(new Set(ids).size,ids.length);
    for(const h of page.structuredData.headings)assert.ok(ids.includes('#'+h.id));
    for(const c of page.structuredData.contents)assert.ok(!c.heading||ids.includes('#'+c.heading));
    assert.equal(blocks.length,original.length);
    for(let i=0;i<blocks.length;i++){
      const block=blocks[i];codeBlocks++;languages[block.lang]=(languages[block.lang]??0)+1;
      assert.equal(block.lines.map(line=>line.map(([v])=>v).join('')).join('\n'),original[i].value);
      for(const line of block.lines)for(const [,color] of line)assert.ok(color>=-1&&color<block.colors.length);
    }
  }
  assert.equal(codeBlocks,171);assert.deepEqual(languages,{bash:9,json:162});
  assert.ok(a.bytes.length<=LIMITS.bundle);
  console.log(JSON.stringify({pages:a.bundle.pages.length,bytes:a.bytes.length,maxPageBytes:Math.max(...a.bundle.pages.map(p=>encode(p).length)),codeBlocks,languages,headingMismatches:[],warnings:a.warnings}));
});
test('repeated, inline-code, Chinese/Russian and nested Callout headings share stable TOC ids',async()=>fixture(async dir=>{
  const {bundle}=await compile({root:dir});
  assert.deepEqual(bundle.pages[0].toc.map(x=>x.url),['#same-heading','#same-heading-1','#中文-русский']);
  assert.ok(bundle.pages[0].structuredData.headings.some(h=>h.id==='中文-русский'));
}));
test('English edits exclude stale translations from pages, trees, structured data and language map',async()=>fixture(async dir=>{
  const path=join(dir,'content/en/get-started/introduction.mdx');await writeFile(path,(await readFile(path,'utf8')).replace('Alpha text.','New facts.'));
  const {bundle,warnings}=await compile({root:dir});
  assert.equal(bundle.pages.length,1);assert.equal(warnings.length,2);assert.equal(bundle.trees.ru.length,0);assert.ok(bundle.pages.every(p=>p.locale==='en'));assert.ok(!('search' in bundle));
  assert.deepEqual(Object.keys(bundle.translations['get-started.introduction']),['en']);
}));
test('drafts and assets referenced only by drafts are excluded',async()=>fixture(async dir=>{
  await mkdir(join(dir,'content/en/drafts'));await writeFile(join(dir,'content/en/drafts/secret.mdx'),'---\ndocId: draft.secret\ntitle: Secret\ndescription: Secret\nkind: reference\nstatus: draft\nsources: [api]\n---\n\n## Draft\n\n[Asset](/assets/not-present.json)\n');
  const {bundle}=await compile({root:dir});assert.equal(bundle.pages.length,3);assert.deepEqual(bundle.assets,{});
}));
for(const source of ['export const secret = 1','Hello {process.env.TOKEN}','<script>alert(1)</script>','<Unknown />','<Callout type={"info"}>x</Callout>','<Callout type="info" onClick="x">x</Callout>','[bad](javascript:alert)','![external](https://example.com/image.png)','# Duplicate H1','- [x] task','Footnote[^1]\n\n[^1]: no','Math $x+y$','$$\nx+y\n$$'])
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

test('compact json and bash tokens match direct Shiki output, including exact whitespace',async()=>{
  for(const [lang,value] of [['json','{ "key": [1, true] }\n'],['bash','curl --help\n  echo "$HOME"']]){
    const {body}=await compileBody('```'+lang+' title="Example"\n'+value+'\n```',[]);
    const block=body.children[0];assert.equal(block.title,'Example');
    const raw=await codeToTokens(value,{lang,themes,defaultColor:false});
    assert.deepEqual(block.lines.map(line=>line.map(([content,index])=>({content,...(index===-1?{}:block.colors[index])}))),raw.tokens.map(line=>line.map(t=>({content:t.content,...(t.variants?{light:t.variants.light.color,dark:t.variants.dark.color}:{})}))));
  }
  const warnings=[];const {body}=await compileBody('```unknown-language\nplain text\n```',warnings);
  assert.equal(body.children[0].lang,'text');assert.equal(warnings.length,1);
  await assert.rejects(compileBody('```json eval="true"\n{}\n```',[]),/metadata/);
});
test('Callout supports only literal type and optional title, with no duplicated children',async()=>{
  const {body}=await compileBody('<Callout type="warning" title="Attention">\n\nBody.\n\n</Callout>',[]);
  assert.deepEqual(body.children[0].props,{type:'warning',title:'Attention'});
  assert.equal(body.children[0].children.length,1);
  for(const s of ['<Callout type="info" title={x} />','<Callout type="info" type="warning" />','<Callout {...props} />'])assert.throws(()=>syntaxCheck(s));
});
test('strict v2 contract rejects injected executable tags, props, unsafe URLs and invalid palettes',async()=>fixture(async dir=>{
  const {bundle}=await compile({root:dir});
  const element=(tagName,properties)=>({type:'element',tagName,properties,children:[]});
  const nodes=[
    element('script',{}),element('iframe',{}),element('p',{onClick:'x'}),element('p',{style:'color:red'}),element('p',{className:['x']}),
    element('a',{href:'javascript:alert(1)'}),element('a',{href:'/docs/api/overview'}),element('img',{src:'https://evil.test/a.png',alt:'x'}),
    {type:'codeBlock',lang:'json',colors:[{light:'red;background:url(x)',dark:'#000000'}],lines:[[['x',0]]]},
    {type:'codeBlock',lang:'text',colors:[],lines:[[['x',0]]]},
    {type:'component',name:'Unknown',props:{type:'info'},children:[]},
  ];
  for(const node of nodes){const candidate=structuredClone(bundle);candidate.pages[0].body.children.push(node);assert.equal(Bundle.safeParse(candidate).success,false,JSON.stringify(node));}
  let nested={type:'text',value:'x'};for(let i=0;i<66;i++)nested={type:'element',tagName:'blockquote',children:[nested]};
  const candidate=structuredClone(bundle);candidate.pages[0].body.children=[nested];assert.equal(Bundle.safeParse(candidate).success,false);
  const oversized=structuredClone(bundle);oversized.pages[0].body.children=[{type:'text',value:'x'.repeat(LIMITS.page)}];assert.equal(Bundle.safeParse(oversized).success,false);
}));
test('links resolve to actual locale and canonical root, including English fallback and assets',async()=>fixture(async dir=>{
  const slug='get-started/target';
  const p=join(dir,'content/en/'+slug+'.mdx');
  await writeFile(p,'---\ndocId: get-started.target\ntitle: Target\ndescription: Target\nkind: reference\nstatus: ready\nsources: [api]\n---\n\n## Destination\n');
  const nav=JSON.parse(await readFile(join(dir,'navigation.json')));nav.groups[0].pages.push(slug);await writeFile(join(dir,'navigation.json'),JSON.stringify(nav));
  await writeFile(join(dir,'assets/test.json'),'{}');
  for(const locale of ['en','zh-CN','ru']){
    const path=join(dir,'content',locale,'get-started/introduction.mdx');
    let source=await readFile(path,'utf8');source+='\n[Self](/docs/get-started/introduction#same-heading)\n\n[Explicit](/en/docs/get-started/introduction)\n\n[Fallback](/docs/get-started/target#destination)\n\n[Download](/assets/test.json)\n';
    if(locale!=='en')source=source.replace(/sourceDigest: .*/,`sourceDigest: "sha256:${digest(await readFile(join(dir,'content/en/get-started/introduction.mdx')))}"`);
    await writeFile(path,source);
  }
  const {bundle}=await compile({root:dir});
  for(const locale of ['en','zh-CN','ru']){
    const page=bundle.pages.find(p=>p.locale===locale&&p.slug==='get-started/introduction');const hrefs=[];walk(page.body,n=>{if(n.type==='element'&&n.tagName==='a')hrefs.push(n.properties.href);});
    assert.ok(hrefs.includes(`/${locale}/docs#same-heading`));assert.ok(hrefs.includes('/en/docs'));assert.ok(hrefs.includes('/en/docs/get-started/target#destination'));assert.ok(hrefs.includes('/assets/test.json'));
  }
  assert.ok(bundle.assets['/assets/test.json']);
  assert.ok(bundle.redirects.some(r=>r.locale==='ru'&&r.from===slug&&r.toLocale==='en'&&r.status===307));
  await writeFile(p,(await readFile(p,'utf8'))+'\n[Broken](/docs/get-started/missing)\n');await assert.rejects(compile({root:dir}),/Broken link/);
}));
test('duplicate custom heading IDs fail instead of splitting TOC and anchor behavior',async()=>{
  await assert.rejects(compileBody('## One [#same]\n\n## Two [#same]',[]),/Duplicate heading/);
});
