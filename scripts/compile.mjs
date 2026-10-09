import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { parseMDX } from '@tinacms/mdx';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm';
import { Baseline, Bundle, Frontmatter, LIMITS, Slug, safeUrl } from '../contracts/schema.ts';

export const locales=['en','zh-CN','ru'];
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  return value;
}
export const encode = value => Buffer.from(JSON.stringify(stable(value))+'\n');
export function plain(node) {
  if (Array.isArray(node)) return node.map(plain).join(' ');
  if (!node) return '';
  if (typeof node.text==='string') return node.text;
  if (node.type==='code_block') return node.value;
  return [plain(node.children),plain(node.props?.children)].filter(Boolean).join(' ');
}
export function walk(node,fn,depth=0) {
  if(depth>64) throw new Error('AST nesting exceeds 64');
  fn(node);
  for(const child of node.children??[]) walk(child,fn,depth+1);
  if(node.props?.children) walk(node.props.children,fn,depth+1);
}
export function pageUrl(locale,slug) { return `/${locale}/docs${slug==='get-started/introduction'?'':`/${slug}`}`; }
const processor=unified().use(remarkParse).use(remarkGfm).use(remarkMdx);
const allowedSyntax=new Set(['root','paragraph','text','heading','emphasis','strong','delete','inlineCode','code','blockquote','list','listItem','thematicBreak','break','link','image','definition','linkReference','imageReference','table','tableRow','tableCell','mdxJsxFlowElement']);
export function syntaxCheck(body) {
  const tree=processor.parse(body);
  function visit(node,depth=0) {
    if(depth>64 || !allowedSyntax.has(node.type)) throw new Error(`Unsupported MDX syntax: ${node.type}`);
    if(node.type==='heading' && node.depth===1) throw new Error('H1 comes from frontmatter');
    if(node.type==='listItem' && node.checked!=null) throw new Error('Task lists are not in renderer contract 1');
    if(node.url && !safeUrl(node.url)) throw new Error('Unsafe URL');
    if(node.type==='image' && !node.url.startsWith('/assets/')) throw new Error('Images must use repository assets');
    if(node.type==='mdxJsxFlowElement') {
      if(node.name!=='Callout' || node.attributes.length!==1) throw new Error('Unknown component or props');
      const attr=node.attributes[0];
      if(attr.type!=='mdxJsxAttribute' || attr.name!=='type' || !['info','warning'].includes(attr.value)) throw new Error('Callout requires a literal info/warning type');
    }
    for(const child of node.children??[]) visit(child,depth+1);
  }
  visit(tree);
}
function headings(body) {
  const used=new Set(),toc=[];
  walk(body,node=>{
    // Tina omits the discriminator on code-line leaves. Normalize it once for
    // an O(n) discriminated runtime validator instead of backtracking unions.
    if(typeof node.text==='string' && node.type===undefined)node.type='text';
    if(!/^h[2-6]$/.test(node.type??'')) return;
    const title=plain(node.children).trim();
    const base=title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,'').trim().replace(/\s+/gu,'-')||'section';
    let id=base,n=0;while(used.has(id))id=`${base}-${++n}`;used.add(id);node.id=id;
    toc.push({title,url:`#${id}`,depth:Number(node.type[1])});
  });
  return toc;
}
async function files(dir) {
  const found=[];
  for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)) {
    if(entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${entry.name}`);
    const path=resolve(dir,entry.name);
    if(entry.isDirectory()) found.push(...await files(path));else found.push(path);
  }
  return found;
}
async function textFile(path,limit=LIMITS.page) {
  if((await lstat(path)).size>limit) throw new Error(`Oversized input: ${path}`);
  const bytes=await readFile(path);if(bytes.length>limit)throw new Error('Input grew past limit');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(text.includes('\r'))throw new Error(`Use UTF-8 LF: ${path}`);
  return text;
}
export async function compile({root=process.cwd(),docsCommit='0'.repeat(40)}={}) {
  const json=async path=>JSON.parse(await textFile(resolve(root,path),LIMITS.bundle));
  const lock=await json('tina/tina-lock.json');
  const bodyField=lock.schema.collections[0].fields.find(f=>f.name==='body');
  const baselines={};
  for(const project of ['spider','refinery','api','frontend']) {
    const base=Baseline.parse(await json(`baselines/${project}.json`));
    if(base.project!==project || base.documentationReview!=='reviewed')throw new Error(`Unreviewed/mismatched baseline: ${project}`);
    baselines[project]=base;
  }
  const all=[],warnings=[];
  for(const locale of locales) for(const path of await files(resolve(root,'content',locale))) {
    if(!path.endsWith('.mdx')) throw new Error(`Unexpected content file: ${path}`);
    const slug=Slug.parse(path.slice(resolve(root,'content',locale).length+1,-4));
    const raw=await textFile(path),match=raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if(!match)throw new Error(`Missing frontmatter: ${path}`);
    const yaml=parseDocument(match[1],{uniqueKeys:true});
    if(yaml.errors.length)throw new Error(`Invalid YAML: ${path}`);
    const meta=Frontmatter.parse(yaml.toJS({maxAliasCount:0}));
    if(locale==='en'&&(meta.translationOf||meta.sourceDigest))throw new Error('English cannot be a translation');
    if(locale!=='en'&&(!meta.translationOf||!meta.sourceDigest))throw new Error('Translation provenance required');
    syntaxCheck(match[2]);
    const body=parseMDX(match[2],bodyField,value=>value),toc=headings(body);
    all.push({locale,slug,raw,meta,body,toc});
  }
  const seen=new Set(),canonical=new Map();
  for(const p of all) {
    const key=`${p.locale}:${p.meta.docId}`;
    if(seen.has(key))throw new Error(`Duplicate docId: ${key}`);seen.add(key);
    if(p.locale==='en')canonical.set(p.meta.docId,p);
  }
  const pages=[];
  for(const p of all) {
    if(p.meta.status==='draft')continue;
    if(p.locale!=='en') {
      const en=canonical.get(p.meta.translationOf);
      if(!en||en.meta.docId!==p.meta.docId||en.slug!==p.slug)throw new Error(`Translation identity mismatch: ${p.slug}`);
      if(en.meta.status==='draft'||p.meta.sourceDigest!==`sha256:${digest(en.raw)}`) {warnings.push(`Excluded stale translation: ${p.locale}/${p.slug}`);continue;}
      if(JSON.stringify([...en.meta.sources].sort())!==JSON.stringify([...p.meta.sources].sort()))throw new Error('Translation sources differ');
    }
    const {docId,title,description,status,sources,sourceDigest}=p.meta;
    const page={docId,locale:p.locale,slug:p.slug,title,description,status,sources,body:p.body,toc:p.toc,...(sourceDigest?{sourceDigest}:{})};
    if(encode(page).length>LIMITS.page)throw new Error(`Page exceeds byte limit: ${p.slug}`);
    pages.push(page);
  }
  pages.sort((a,b)=>`${a.locale}/${a.slug}`<`${b.locale}/${b.slug}`?-1:1);
  const byKey=new Map(pages.map(p=>[`${p.locale}:${p.slug}`,p]));
  const translations=Object.create(null);for(const p of pages)(translations[p.docId]??={})[p.locale]=p.slug;
  const navigation=await json('navigation.json'),trees={},search={},redirects=[];
  if(navigation.schemaVersion!==1)throw new Error('Unknown navigation schema');
  const navSlugs=navigation.groups.flatMap(g=>g.pages);
  if(new Set(navSlugs).size!==navSlugs.length)throw new Error('Duplicate navigation entry');
  for(const slug of navSlugs)if(!all.some(p=>p.locale==='en'&&p.slug===slug))throw new Error(`Dangling navigation: ${slug}`);
  for(const p of pages)if(!navSlugs.includes(p.slug))throw new Error(`Page missing from navigation: ${p.slug}`);
  for(const locale of locales) {
    trees[locale]=navigation.groups.map(g=>({type:'folder',name:g.title[locale],children:g.pages.flatMap(slug=>{
      const p=byKey.get(`${locale}:${slug}`);return p?[{type:'page',key:`${locale}:${slug}`,name:p.title,url:pageUrl(locale,slug)}]:[];
    })})).filter(g=>g.children.length);
    search[locale]=pages.filter(p=>p.locale===locale).flatMap(p=>{
      const base={docId:p.docId,slug:p.slug,title:p.title};
      const records=[{...base,url:pageUrl(locale,p.slug),text:plain(p.body),anchor:''}];
      for(const h of p.toc) records.push({...base,title:`${p.title} — ${h.title}`,url:pageUrl(locale,p.slug)+h.url,text:h.title,anchor:h.url.slice(1)});
      return records;
    });
    const hasIntro=byKey.has(`${locale}:get-started/introduction`);
    redirects.push({locale,from:'get-started/introduction',to:'',toLocale:hasIntro?locale:'en',status:hasIntro?308:307});
    if(locale!=='en')for(const p of pages.filter(p=>p.locale==='en'&&p.slug!=='get-started/introduction'))if(!byKey.has(`${locale}:${p.slug}`))redirects.push({locale,from:p.slug,to:p.slug,toLocale:'en',status:307});
  }
  // Explicit redirects are terminal, never chains. Canonical introduction is represented by an empty target.
  for(const r of await json('redirects.json')) {
    if(byKey.has(`${r.locale}:${r.from}`)||redirects.some(x=>x.locale===r.locale&&x.from===r.from))throw new Error('Redirect shadows an existing route');
    if(!byKey.has(`${r.toLocale}:${r.to||'get-started/introduction'}`))throw new Error('Dangling redirect target');
    redirects.push(r);
  }
  const assets={},assetBytes=new Map();
  const assetDirectory=await lstat(resolve(root,'assets'));
  if(assetDirectory.isSymbolicLink()||!assetDirectory.isDirectory())throw new Error('Assets must be a repository directory');
  for(const p of pages) {
    const links=[];walk(p.body,node=>{
      // Check the resolved AST too: reference-style Markdown images have no
      // URL on their syntax node and otherwise bypass the source-image rule.
      if(node.type==='img'&&(!node.url.startsWith('/assets/')||!node.alt?.trim()))throw new Error('Images require repository assets and non-empty alt text');
      if(node.url)links.push(node.url);
    });
    for(const url of links) {
      if(url.startsWith('/assets/')) {
        if(!/^\/assets\/[a-zA-Z0-9._-]+$/.test(url))throw new Error('Invalid asset path');
        if(assets[url])continue;
        const path=resolve(root,url.slice(1)),stat=await lstat(path);
        if(stat.isSymbolicLink()||!stat.isFile()||stat.size>LIMITS.asset)throw new Error('Invalid/oversized asset');
        const bytes=await readFile(path),mime={'.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[extname(path)];
        if(!mime)throw new Error('Unsupported asset type (SVG is not enabled)');
        if(mime==='application/json')JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        if(mime==='image/png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Invalid PNG');
        if(mime==='image/jpeg'&&!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255))throw new Error('Invalid JPEG');
        if(mime==='image/webp'&&!(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'))throw new Error('Invalid WebP');
        const sha256=digest(bytes),key=`assets/${sha256}/${basename(path)}`;
        assets[url]={key,sha256,mime,size:bytes.length};assetBytes.set(key,bytes);
      } else if(url.startsWith('#')||/^\/(?:en\/|zh-CN\/|ru\/)?docs(?:\/|#|$)/.test(url)) {
        const target=new URL(url,`https://docs.invalid${pageUrl(p.locale,p.slug)}`);
        const m=target.pathname.match(/^\/(?:(en|zh-CN|ru)\/)?docs(?:\/(.*))?$/);
        const locale=m?.[1]||p.locale,slug=m?(m[2]||'get-started/introduction'):p.slug;
        const linked=byKey.get(`${locale}:${slug}`)||byKey.get(`en:${slug}`);
        if(!linked)throw new Error(`Broken link ${p.locale}/${p.slug}: ${url}`);
        if(target.hash&&!linked.toc.some(h=>h.url===decodeURI(target.hash)))throw new Error(`Broken anchor: ${url}`);
      }
    }
  }
  const schemaSource=await textFile(resolve(root,'contracts/schema.ts'),LIMITS.bundle);
  const bundle=Bundle.parse({schemaVersion:1,rendererContract:1,docsCommit,compiler:{version:'1.0.0',parserVersion:'2.3.0',schemaDigest:digest(schemaSource+JSON.stringify(stable(bodyField)))},baselines,pages,trees,search,translations,redirects,assets});
  const bytes=encode(bundle);if(bytes.length>LIMITS.bundle)throw new Error('Bundle exceeds byte limit');
  return {bundle,bytes,releaseId:digest(bytes),assetBytes,warnings};
}
