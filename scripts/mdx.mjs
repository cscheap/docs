import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import { remarkHeading, remarkStructure } from 'fumadocs-core/mdx-plugins';
import { codeToTokens, bundledLanguages, bundledLanguagesAlias } from 'shiki';
import { safeUrl } from '../contracts/schema.ts';

export const themes = { light:'github-light', dark:'github-dark' };
const packages=['fumadocs-core','shiki','github-slugger','unified','remark-parse','remark-mdx','remark-gfm','remark-math','remark-rehype'];
export const toolchain=Object.fromEntries(await Promise.all(packages.map(async name=>{
  let dir=dirname(fileURLToPath(import.meta.resolve(name==='fumadocs-core'?'fumadocs-core/mdx-plugins':name)));
  for(;;){
    try {const pkg=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));if(pkg.name===name)return [name,pkg.version];}catch(error){if(error.code!=='ENOENT')throw error;}
    const parent=dirname(dir);if(parent===dir)throw new Error(`Cannot find package version: ${name}`);dir=parent;
  }
})));
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMdx).use(remarkMath);
const allowedSyntax=new Set(['root','paragraph','text','heading','emphasis','strong','delete','inlineCode','code','blockquote','list','listItem','thematicBreak','break','link','image','definition','linkReference','imageReference','table','tableRow','tableCell','mdxJsxFlowElement']);
export function visit(node,fn,depth=0){
  if(depth>64)throw new Error('AST nesting exceeds 64');fn(node);
  for(const child of node.children??[])visit(child,fn,depth+1);
}
export function syntaxCheck(source){
  const tree=parser.parse(source);
  visit(tree,node=>{
    if(!allowedSyntax.has(node.type))throw new Error(`Unsupported MDX syntax: ${node.type}`);
    if(node.type==='heading'&&node.depth===1)throw new Error('H1 comes from frontmatter');
    if(node.type==='listItem'&&node.checked!=null)throw new Error('Task lists are not in renderer contract 2');
    if(node.type==='list'&&node.ordered&&node.start<1)throw new Error('Ordered lists must start at a positive integer');
    if(node.url&&!safeUrl(node.url))throw new Error('Unsafe URL');
    if(node.type==='image'&&(!node.url.startsWith('/assets/')||!node.alt?.trim()))throw new Error('Images require repository assets and non-empty alt text');
    if(node.type==='mdxJsxFlowElement'){
      const attrs=node.attributes;
      if(node.name!=='Callout'||attrs.some(a=>a.type!=='mdxJsxAttribute'||!['type','title'].includes(a.name)||typeof a.value!=='string')||new Set(attrs.map(a=>a.name)).size!==attrs.length)throw new Error('Unknown component or props');
      if(!['info','warning'].includes(attrs.find(a=>a.name==='type')?.value))throw new Error('Callout requires a literal info/warning type');
    }
  });
  return tree;
}
export async function highlight(node,warnings){
  let lang=node.lang?.toLowerCase()||'text';
  if(lang!=='text'&&!Object.hasOwn(bundledLanguages,lang)&&!Object.hasOwn(bundledLanguagesAlias,lang)){warnings.push(`Unknown code language ${lang}; rendered as text`);lang='text';}
  if(!/^[a-z0-9+#-]{1,32}$/.test(lang))throw new Error('Invalid code language');
  const match=node.meta?.match(/^title="([^"\r\n]*)"$/);
  if(node.meta&&!match)throw new Error('Only title="…" code block metadata is supported');
  const result=await codeToTokens(node.value,{lang,themes,defaultColor:false});
  const colors=[],indices=new Map();
  const lines=result.tokens.map(line=>line.map(token=>{
    const light=token.variants?.light?.color,dark=token.variants?.dark?.color;
    if(!light&&!dark)return [token.content,-1];
    if(!light||!dark)throw new Error('Incomplete highlighted token colors');
    const key=`${light}/${dark}`;
    if(!indices.has(key)){indices.set(key,colors.length);colors.push({light,dark});}
    return [token.content,indices.get(key)];
  }));
  if(colors.length>64)throw new Error('Code palette exceeds 64 colors');
  if(lines.map(line=>line.map(([text])=>text).join('')).join('\n')!==node.value)throw new Error('Highlighter changed code text');
  return {type:'codeBlock',lang,...(match?{title:match[1]}:{}),colors,lines};
}
const transform=parser().use(remarkHeading).use(remarkStructure).use(remarkRehype,{
  handlers:{
    code(_state,node){return node.data.compactCode;},
    mdxJsxFlowElement(state,node){return {type:'component',name:'Callout',props:Object.fromEntries(node.attributes.map(a=>[a.name,a.value])),children:state.all(node)};},
  },
});
const blockParents=new Set(['root','blockquote','ul','ol','table','thead','tbody','tr','component']);
function clean(node){
  if(node.type==='codeBlock')return node;
  if(node.type==='text')return {type:'text',value:node.value};
  const children=(node.children??[]).filter(child=>!(blockParents.has(node.tagName??node.type)&&child.type==='text'&&!child.value.trim())).map(clean);
  if(node.type==='root')return {type:'root',children};
  if(node.type==='component')return {type:'component',name:node.name,props:node.props,children};
  if(node.type!=='element')throw new Error(`Unexpected output node: ${node.type}`);
  const properties=Object.fromEntries(Object.entries(node.properties??{}).filter(([,value])=>value!=null));
  return {type:'element',tagName:node.tagName,...(Object.keys(properties).length?{properties}:{}),children};
}
export async function compileBody(source,warnings){
  const tree=syntaxCheck(source),code=[];
  visit(tree,node=>{if(node.type==='code')code.push(node);});
  for(const node of code)node.data={compactCode:await highlight(node,warnings)};
  const file={data:{}};
  const body=clean(await transform.run(tree,file));
  const toc=file.data.toc,structuredData=file.data.structuredData;
  if(new Set(toc.map(h=>h.url)).size!==toc.length)throw new Error('Duplicate heading IDs');
  return {body,toc,structuredData};
}
