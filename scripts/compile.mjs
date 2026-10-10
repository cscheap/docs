import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { compileBody, syntaxCheck, visit, toolchain, themes } from './mdx.mjs';
export { syntaxCheck };
import { Baseline, Bundle, Frontmatter, LIMITS, Slug, safeUrl } from '../contracts/schema.ts';

export const locales=['en','zh-CN','ru'];
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  return value;
}
export const encode = value => Buffer.from(JSON.stringify(stable(value))+'\n');
export const walk=visit;
export function pageUrl(locale,slug) { return `/${locale}/docs${slug==='get-started/introduction'?'':`/${slug}`}`; }
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
    const {body,toc,structuredData}=await compileBody(match[2],warnings);
    all.push({locale,slug,raw,meta,body,toc,structuredData});
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
    const page={docId,locale:p.locale,slug:p.slug,title,description,status,sources,body:p.body,toc:p.toc,structuredData:p.structuredData,...(sourceDigest?{sourceDigest}:{})};
    if(encode(page).length>LIMITS.page)throw new Error(`Page exceeds byte limit: ${p.slug}`);
    pages.push(page);
  }
  pages.sort((a,b)=>`${a.locale}/${a.slug}`<`${b.locale}/${b.slug}`?-1:1);
  const byKey=new Map(pages.map(p=>[`${p.locale}:${p.slug}`,p]));
  const translations=Object.create(null);for(const p of pages)(translations[p.docId]??={})[p.locale]=p.slug;
  const navigation=await json('navigation.json'),trees={},redirects=[];
  if(navigation.schemaVersion!==1)throw new Error('Unknown navigation schema');
  const navSlugs=navigation.groups.flatMap(g=>g.pages);
  if(new Set(navSlugs).size!==navSlugs.length)throw new Error('Duplicate navigation entry');
  for(const slug of navSlugs)if(!all.some(p=>p.locale==='en'&&p.slug===slug))throw new Error(`Dangling navigation: ${slug}`);
  for(const p of pages)if(!navSlugs.includes(p.slug))throw new Error(`Page missing from navigation: ${p.slug}`);
  for(const locale of locales) {
    trees[locale]=navigation.groups.map(g=>({type:'folder',name:g.title[locale],children:g.pages.flatMap(slug=>{
      const p=byKey.get(`${locale}:${slug}`);return p?[{type:'page',key:`${locale}:${slug}`,name:p.title,url:pageUrl(locale,slug)}]:[];
    })})).filter(g=>g.children.length);
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
      if(node.type!=='element')return;
      const prop=node.tagName==='img'?'src':node.tagName==='a'?'href':null;
      if(!prop)return;
      const url=node.properties[prop];
      if(!safeUrl(url))throw new Error('Unsafe URL');
      if(node.tagName==='img'&&(!url.startsWith('/assets/')||!node.properties.alt?.trim()))throw new Error('Images require repository assets and non-empty alt text');
      links.push({node,prop,url});
    });
    for(const {node,prop,url} of links) {
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
        const anchor=target.hash?decodeURI(target.hash):'';
        if(anchor&&!linked.toc.some(h=>h.url===anchor))throw new Error(`Broken anchor: ${url}`);
        node.properties[prop]=url.startsWith('#')?anchor:pageUrl(linked.locale,linked.slug)+anchor;
      }
    }
  }
  const bundle=Bundle.parse({schemaVersion:2,rendererContract:2,docsCommit,compiler:{version:'2.0.0',toolchain,themes},baselines,pages,trees,translations,redirects,assets});
  const bytes=encode(bundle);if(bytes.length>LIMITS.bundle)throw new Error('Bundle exceeds byte limit');
  return {bundle,bytes,releaseId:digest(bytes),assetBytes,warnings};
}
