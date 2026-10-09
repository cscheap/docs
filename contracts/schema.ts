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
const Text = z.object({ type: z.literal('text'), text: z.string(), bold:z.boolean().optional(), italic:z.boolean().optional(), strikethrough:z.boolean().optional(), code:z.boolean().optional() }).strict();
type TextNode = z.infer<typeof Text>;
// Explicit recursive union: no arbitrary HTML, unknown nodes, arbitrary props or executable MDX.
export type TinaNode = TextNode
  | { type:'root'|'p'|'blockquote'|'ul'|'ol'|'li'|'lic'|'hr'|'break'|'tr'|'td'|'code_line'; children:TinaNode[] }
  | { type:'h2'|'h3'|'h4'|'h5'|'h6'; id:string; children:TinaNode[] }
  | { type:'a'; url:string; title?:string|null; children:TinaNode[] }
  | { type:'img'; url:string; alt?:string|null; caption?:string|null; children:TinaNode[] }
  | { type:'code_block'; lang?:string|null; value:string; children:TinaNode[] }
  | { type:'table'; children:TinaNode[]; props:{align:('left'|'right'|'center'|null)[]} }
  | { type:'mdxJsxFlowElement'; name:'Callout'; children:TinaNode[]; props:{type:'info'|'warning'; children:TinaNode} };
export const AstNode: z.ZodType<TinaNode> = z.lazy(() => NodeVariants);
const NodeVariants = z.discriminatedUnion('type',[
  Text,
  z.object({type:z.enum(['root','p','blockquote','ul','ol','li','lic','hr','break','tr','td','code_line']),children:z.array(AstNode)}).strict(),
  z.object({type:z.enum(['h2','h3','h4','h5','h6']),id:z.string().min(1),children:z.array(AstNode)}).strict(),
  z.object({type:z.literal('a'),url:Url,title:z.string().nullable().optional(),children:z.array(AstNode)}).strict(),
  z.object({type:z.literal('img'),url:Url,alt:z.string().nullable().optional(),caption:z.string().nullable().optional(),children:z.array(AstNode)}).strict(),
  z.object({type:z.literal('code_block'),lang:z.string().nullable().optional(),value:z.string(),children:z.array(AstNode)}).strict(),
  z.object({type:z.literal('table'),children:z.array(AstNode),props:z.object({align:z.array(z.enum(['left','right','center']).nullable())}).strict()}).strict(),
  z.object({type:z.literal('mdxJsxFlowElement'),name:z.literal('Callout'),children:z.array(AstNode),props:z.object({type:z.enum(['info','warning']),children:AstNode}).strict()}).strict(),
]);
export const Root = AstNode.refine(n => 'type' in n && n.type === 'root', 'Expected root AST');
export const Frontmatter = z.object({
  docId:z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),title:z.string().min(1).max(200),description:z.string().min(1).max(400),
  kind:z.enum(['tutorial','how-to','reference','explanation']),status:z.enum(['draft','ready','deprecated']),
  sources:z.array(Project).min(1).refine(v => new Set(v).size === v.length),
  translationOf:z.string().optional(),sourceDigest:z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
}).strict();
export const Baseline = z.object({schemaVersion:z.literal(1),project:Project,repository:z.string().url(),ref:z.literal('refs/heads/master'),commit:Commit,capturedOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),verification:z.literal('remote-ref-matches-local-head'),documentationReview:z.enum(['pending','reviewed'])}).strict();
export const Page = z.object({docId:Frontmatter.shape.docId,locale:Locale,slug:Slug,title:Frontmatter.shape.title,description:Frontmatter.shape.description,status:z.enum(['ready','deprecated']),sources:Frontmatter.shape.sources,body:Root,toc:z.array(z.object({title:z.string(),url:z.string().startsWith('#'),depth:z.number().int().min(2).max(6)}).strict()),sourceDigest:Frontmatter.shape.sourceDigest}).strict();
const TreePage = z.object({type:z.literal('page'),key:z.string(),name:z.string(),url:Url}).strict();
const Tree = z.array(z.object({type:z.literal('folder'),name:z.string(),children:z.array(TreePage)}).strict());
const Search = z.array(z.object({docId:z.string(),slug:Slug,title:z.string(),url:Url,text:z.string(),anchor:z.string()}).strict());
export const Asset = z.object({key:z.string().regex(/^assets\/[a-f0-9]{64}\/[a-zA-Z0-9._-]+$/),sha256:Digest,mime:z.enum(['application/json','image/png','image/jpeg','image/webp']),size:z.number().int().positive().max(LIMITS.asset)}).strict();
export const Bundle = z.object({
  schemaVersion:z.literal(1),rendererContract:z.literal(1),docsCommit:Commit,
  compiler:z.object({version:z.literal('1.0.0'),parserVersion:z.literal('2.3.0'),schemaDigest:Digest}).strict(),
  baselines:z.object({spider:Baseline,refinery:Baseline,api:Baseline,frontend:Baseline}).strict(),
  pages:z.array(Page).min(1),trees:z.object({en:Tree,'zh-CN':Tree,ru:Tree}).strict(),
  search:z.object({en:Search,'zh-CN':Search,ru:Search}).strict(),
  translations:z.record(z.record(Locale,Slug)),
  redirects:z.array(z.object({locale:Locale,from:Slug,to:z.union([Slug,z.literal('')]),toLocale:Locale,status:z.union([z.literal(307),z.literal(308)])}).strict()),
  assets:z.record(Asset),
}).strict();
export const ReleaseRef = z.object({releaseId:Digest,docsCommit:Commit}).strict();
export const Pointer = z.object({schemaVersion:z.literal(1),current:ReleaseRef,previous:ReleaseRef.nullable(),activatedAt:z.string().datetime()}).strict();
export const Published = z.object({schemaVersion:z.literal(1),releaseId:Digest,docsCommit:Commit}).strict();
export type BundleV1 = z.infer<typeof Bundle>;
export type PageV1 = z.infer<typeof Page>;
export type PointerV1 = z.infer<typeof Pointer>;
