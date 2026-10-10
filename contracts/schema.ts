// The frontend uses Zod 4; its zod/v3 compatibility export preserves the
// partial enum-keyed translation maps used by this contract without migration.
import { z } from 'zod/v3';

export const LIMITS = { pointer: 16 * 1024, bundle: 8 * 1024 * 1024, page: 256 * 1024, asset: 5 * 1024 * 1024 } as const;
export const Locale = z.enum(['en', 'zh-CN', 'ru']);
export const Project = z.enum(['spider', 'refinery', 'api', 'frontend']);
export const Commit = z.string().regex(/^[a-f0-9]{40}$/);
export const Digest = z.string().regex(/^[a-f0-9]{64}$/);
export const Slug = z.string().regex(/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/);
export function safeUrl(url: string): boolean {
  if (!url || /[\u0000-\u0020\u007f\\]/u.test(url) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(url)) return false;
  if (url.startsWith('//')) return false;
  if (url.startsWith('/') || url.startsWith('#')) return !url.split(/[?#]/)[0].split('/').some(v => ['.', '..'].includes(decodeURIComponentSafe(v)));
  try { const parsed = new URL(url); return ['https:', 'http:', 'mailto:'].includes(parsed.protocol) && !parsed.username && !parsed.password; }
  catch { return false; }
}
function decodeURIComponentSafe(v: string) { try { return decodeURIComponent(v); } catch { return '..'; } }
export const Url = z.string().max(4096).refine(safeUrl, 'Unsafe URL');
export const AssetPath = z.string().regex(/^\/assets\/(?!\.{1,2}$)[a-zA-Z0-9._-]+$/);
export const HeadingId = z.string().min(1).max(200).regex(/^[^\s#%/?\\\u0000-\u001f\u007f]+$/u);
export const SafeHref = Url.refine(url => {
  if (url.startsWith('#')) return HeadingId.safeParse(url.slice(1)).success;
  if (url.startsWith('/assets/')) return AssetPath.safeParse(url).success;
  if (url.startsWith('/')) return /^\/(en|zh-CN|ru)\/docs(?:\/[a-z0-9]+(?:[/-][a-z0-9]+)*)?(?:#[^\s#]+)?$/.test(url);
  return true;
}, 'Expected a resolved document URL, anchor, asset or external URL');
const EmptyProps = z.object({}).strict();
const Text = z.object({ type:z.literal('text'), value:z.string() }).strict();
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
const CodeBlock = z.object({
  type:z.literal('codeBlock'), lang:z.string().regex(/^[a-z0-9+#-]{1,32}$/), title:z.string().optional(),
  colors:z.array(z.object({light:Hex,dark:Hex}).strict()).max(64),
  lines:z.array(z.array(z.tuple([z.string(),z.number().int().min(-1)]))),
}).strict();
const PlainTag = z.enum(['p','strong','em','del','blockquote','ul','li','hr','br','table','thead','tbody','tr','code']);
type ElementNode = {type:'element';children:BodyNode[]} & (
  | {tagName:z.infer<typeof PlainTag>;properties?:Record<string,never>}
  | {tagName:'ol';properties?:{start?:number}}
  | {tagName:'h2'|'h3'|'h4'|'h5'|'h6';properties:{id:string}}
  | {tagName:'a';properties:{href:string;title?:string}}
  | {tagName:'img';properties:{src:string;alt:string;title?:string}}
  | {tagName:'th'|'td';properties?:{align?:'left'|'right'|'center'}}
);
export type BodyNode = z.infer<typeof Text> | z.infer<typeof CodeBlock> | ElementNode
  | {type:'component';name:'Callout';props:{type:'info'|'warning';title?:string};children:BodyNode[]};
export const AstNode: z.ZodType<BodyNode> = z.lazy(() => NodeVariants);
const children = z.array(AstNode);
const Element = z.discriminatedUnion('tagName',[
  z.object({type:z.literal('element'),tagName:PlainTag,properties:EmptyProps.optional(),children}).strict(),
  z.object({type:z.literal('element'),tagName:z.literal('ol'),properties:z.object({start:z.number().int().positive().optional()}).strict().optional(),children}).strict(),
  z.object({type:z.literal('element'),tagName:z.enum(['h2','h3','h4','h5','h6']),properties:z.object({id:HeadingId}).strict(),children}).strict(),
  z.object({type:z.literal('element'),tagName:z.literal('a'),properties:z.object({href:SafeHref,title:z.string().optional()}).strict(),children}).strict(),
  z.object({type:z.literal('element'),tagName:z.literal('img'),properties:z.object({src:AssetPath,alt:z.string().refine(v=>v.trim().length>0),title:z.string().optional()}).strict(),children:z.array(AstNode).max(0)}).strict(),
  z.object({type:z.literal('element'),tagName:z.enum(['th','td']),properties:z.object({align:z.enum(['left','right','center']).optional()}).strict().optional(),children}).strict(),
]);
// Nested discriminants keep recursive validation linear without union backtracking.
const NodeVariants = z.discriminatedUnion('type',[
  Text, CodeBlock,
  z.object({type:z.literal('element'),tagName:z.string(),properties:z.unknown().optional(),children}).strict(),
  z.object({type:z.literal('component'),name:z.literal('Callout'),props:z.object({type:z.enum(['info','warning']),title:z.string().optional()}).strict(),children}).strict(),
]).superRefine((node,ctx)=>{
  if(node.type==='element') {
    // Children have already been validated; avoid walking them a second time.
    const result=Element.safeParse({...node,children:[]});
    if(!result.success)for(const issue of result.error.issues)ctx.addIssue(issue);
    if(['img','hr','br'].includes(node.tagName)&&node.children.length)ctx.addIssue({code:'custom',message:'Void elements cannot have children'});
  }
  if(node.type==='codeBlock'&&node.lines.some(line=>line.some(([,i])=>i>=node.colors.length)))ctx.addIssue({code:'custom',message:'Invalid palette index'});
}) as z.ZodType<BodyNode>;
// Bound depth before recursive Zod parsing, including untrusted downloaded JSON.
const BoundedTree = z.unknown().superRefine((value,ctx)=>{
  const pending:[unknown,number][]=[[value,0]];
  while(pending.length){
    const [node,depth]=pending.pop()!;
    if(depth>64){ctx.addIssue({code:'custom',message:'AST nesting exceeds 64'});return;}
    if(node&&typeof node==='object'&&'children' in node&&Array.isArray(node.children))for(const child of node.children)pending.push([child,depth+1]);
  }
});
export const Root = BoundedTree.pipe(z.object({type:z.literal('root'),children}).strict());
export const StructuredData = z.object({
  headings:z.array(z.object({id:HeadingId,content:z.string()}).strict()),
  contents:z.array(z.object({heading:HeadingId.optional(),content:z.string()}).strict()),
}).strict();
export const Frontmatter = z.object({
  docId:z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),title:z.string().min(1).max(200),description:z.string().min(1).max(400),
  kind:z.enum(['tutorial','how-to','reference','explanation']),status:z.enum(['draft','ready','deprecated']),
  sources:z.array(Project).min(1).refine(v => new Set(v).size === v.length),
  translationOf:z.string().optional(),sourceDigest:z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
}).strict();
export const Baseline = z.object({schemaVersion:z.literal(1),project:Project,repository:z.string().url(),ref:z.literal('refs/heads/master'),commit:Commit,capturedOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),verification:z.literal('remote-ref-matches-local-head'),documentationReview:z.enum(['pending','reviewed'])}).strict();
export const Page = z.object({docId:Frontmatter.shape.docId,locale:Locale,slug:Slug,title:Frontmatter.shape.title,description:Frontmatter.shape.description,status:z.enum(['ready','deprecated']),sources:Frontmatter.shape.sources,body:Root,structuredData:StructuredData,toc:z.array(z.object({title:z.string(),url:z.string().startsWith('#'),depth:z.number().int().min(2).max(6)}).strict()),sourceDigest:Frontmatter.shape.sourceDigest}).strict().refine(p => new TextEncoder().encode(JSON.stringify(p)).length <= LIMITS.page, 'Page exceeds byte limit');
const TreePage = z.object({type:z.literal('page'),key:z.string(),name:z.string(),url:Url}).strict();
const Tree = z.array(z.object({type:z.literal('folder'),name:z.string(),children:z.array(TreePage)}).strict());
export const Asset = z.object({key:z.string().regex(/^assets\/[a-f0-9]{64}\/[a-zA-Z0-9._-]+$/),sha256:Digest,mime:z.enum(['application/json','image/png','image/jpeg','image/webp']),size:z.number().int().positive().max(LIMITS.asset)}).strict();
export const Bundle = z.object({
  schemaVersion:z.literal(2),rendererContract:z.literal(2),docsCommit:Commit,
  compiler:z.object({version:z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),toolchain:z.record(z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/)),themes:z.object({light:z.literal('github-light'),dark:z.literal('github-dark')}).strict()}).strict(),
  baselines:z.object({spider:Baseline,refinery:Baseline,api:Baseline,frontend:Baseline}).strict(),
  pages:z.array(Page).min(1),trees:z.object({en:Tree,'zh-CN':Tree,ru:Tree}).strict(),
  translations:z.record(z.record(Locale,Slug)),
  redirects:z.array(z.object({locale:Locale,from:Slug,to:z.union([Slug,z.literal('')]),toLocale:Locale,status:z.union([z.literal(307),z.literal(308)])}).strict()),
  assets:z.record(Asset),
}).strict();
export const ReleaseRef = z.object({releaseId:Digest,docsCommit:Commit}).strict();
export const Pointer = z.object({schemaVersion:z.literal(1),current:ReleaseRef,previous:ReleaseRef.nullable(),activatedAt:z.string().datetime()}).strict();
export const Published = z.object({schemaVersion:z.literal(1),releaseId:Digest,docsCommit:Commit}).strict();
export type BundleV2 = z.infer<typeof Bundle>;
export type PageV2 = z.infer<typeof Page>;
export type PointerV1 = z.infer<typeof Pointer>;
