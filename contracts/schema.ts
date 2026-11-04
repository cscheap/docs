// Content contract v3 (ADR 0006). The frontend uses Zod 4; its zod/v3 compatibility export
// preserves the partial enum-keyed translation maps used by this contract without migration.
import { z } from 'zod/v3';

export const LIMITS = {
  pointer: 16 * 1024, marker: 16 * 1024, item: 64 * 1024,
  page: 256 * 1024, search: 1024 * 1024, manifest: 1024 * 1024, asset: 5 * 1024 * 1024,
} as const;
export const Locale = z.enum(['en', 'zh-CN', 'ru']);
export const LOCALES = Locale.options;
export const Project = z.enum(['spider', 'refinery', 'api', 'frontend']);
export const Commit = z.string().regex(/^[a-f0-9]{40}$/);
export const Digest = z.string().regex(/^[a-f0-9]{64}$/);
export const Slug = z.string().regex(/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/);
export const DocId = z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
export const Kind = z.enum(['tutorial', 'how-to', 'reference', 'explanation']);
export const Stage = z.enum(['draft', 'reviewed', 'published', 'held', 'retired']);
export const Channel = z.enum(['preview', 'production']);
export const CHANNELS = Channel.options;
/** Which stages a channel projects. Everything else stays out of every channel. */
export const CHANNEL_STAGES: Readonly<Record<z.infer<typeof Channel>, readonly z.infer<typeof Stage>[]>> =
  Object.freeze({ preview: ['reviewed', 'published'], production: ['published'] });
export const Actor = z.enum(['human', 'claude-code', 'grok', 'chatgpt', 'claude']);
export const INTRO_SLUG = 'get-started/introduction';

export function safeUrl(url: string): boolean {
  if (!url || /[\u0000- \u007f\\]/u.test(url) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(url)) return false;
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

// ---- Body AST (unchanged from contract v2; the frontend renderer depends on exactly these shapes) ----
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
export const Toc = z.array(z.object({title:z.string(),url:z.string().startsWith('#'),depth:z.number().int().min(2).max(6)}).strict());

// ---- Source side: one unit directory = item.json + <locale>.mdx ----
/** RFC 3339 UTC with a real calendar date and in-range time; Date.parse alone would normalise 2026-02-30. */
export function isRfc3339Utc(value: string): boolean {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}
const Rfc3339Utc = z.string().refine(isRfc3339Utc, 'Invalid RFC 3339 UTC timestamp');
export const WorkflowEntry = z.object({stage:Stage,by:Actor,at:Rfc3339Utc,note:z.string().max(500).optional()}).strict();
export const Item = z.object({
  schemaVersion:z.literal(3),docId:DocId,slug:Slug,kind:Kind,stage:Stage,deprecated:z.boolean().optional(),
  sources:z.array(Project).min(1).refine(v=>new Set(v).size===v.length,'Duplicate source'),
  generated:z.boolean().optional(),workflow:z.array(WorkflowEntry).min(1),
}).strict().superRefine((item,ctx)=>{
  if(item.workflow.at(-1)!.stage!==item.stage)ctx.addIssue({code:'custom',message:'Last workflow entry must match stage'});
  for(let i=1;i<item.workflow.length;i+=1)if(Date.parse(item.workflow[i].at)<Date.parse(item.workflow[i-1].at))ctx.addIssue({code:'custom',message:'Workflow timestamps must not decrease'});
});
export const SourceDigest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const LocaleFrontmatter = z.object({title:z.string().min(1).max(200),description:z.string().min(1).max(400),sourceDigest:SourceDigest.optional()}).strict();
export const Baseline = z.object({schemaVersion:z.literal(1),project:Project,repository:z.string().url(),ref:z.literal('refs/heads/master'),commit:Commit,capturedOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),verification:z.literal('remote-ref-matches-local-head'),documentationReview:z.enum(['pending','reviewed'])}).strict();

// ---- Published side: content-addressed objects, one manifest per channel, pointer + activation marker ----
export const PageObject = z.object({
  schemaVersion:z.literal(3),docId:DocId,locale:Locale,slug:Slug,title:LocaleFrontmatter.shape.title,description:LocaleFrontmatter.shape.description,
  kind:Kind,deprecated:z.boolean(),body:Root,toc:Toc,structuredData:StructuredData,
}).strict();
export const SearchIndex = z.object({
  schemaVersion:z.literal(3),channel:Channel,locale:Locale,
  pages:z.array(z.object({id:DocId,title:z.string(),url:Url,structuredData:StructuredData}).strict()),
}).strict();
export const ObjectRef = z.object({sha256:Digest,size:z.number().int().positive()}).strict();
export const ManifestPage = z.object({
  docId:DocId,locale:Locale,slug:Slug,title:LocaleFrontmatter.shape.title,description:LocaleFrontmatter.shape.description,
  kind:Kind,deprecated:z.boolean(),object:ObjectRef,
}).strict();
const TreePage = z.object({type:z.literal('page'),key:z.string(),name:z.string(),url:Url}).strict();
const Tree = z.array(z.object({type:z.literal('folder'),name:z.string(),children:z.array(TreePage)}).strict());
export const Asset = z.object({key:z.string().regex(/^assets\/[a-f0-9]{64}\/[a-zA-Z0-9._-]+$/),sha256:Digest,mime:z.enum(['application/json','image/png','image/jpeg','image/webp']),size:z.number().int().positive().max(LIMITS.asset)}).strict();
export const Manifest = z.object({
  schemaVersion:z.literal(3),channel:Channel,docsCommit:Commit,
  compiler:z.object({version:z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),toolchain:z.record(z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/)),themes:z.object({light:z.literal('github-light'),dark:z.literal('github-dark')}).strict()}).strict(),
  baselines:z.object({spider:Baseline,refinery:Baseline,api:Baseline,frontend:Baseline}).strict(),
  pages:z.array(ManifestPage).min(1),trees:z.object({en:Tree,'zh-CN':Tree,ru:Tree}).strict(),
  translations:z.record(z.record(Locale,Slug)),
  redirects:z.array(z.object({locale:Locale,from:Slug,to:z.union([Slug,z.literal('')]),toLocale:Locale,status:z.union([z.literal(307),z.literal(308)])}).strict()),
  assets:z.record(Asset),
  search:z.object({en:ObjectRef,'zh-CN':ObjectRef,ru:ObjectRef}).strict(),
}).strict();
export const ReleaseRef = z.object({releaseId:Digest,docsCommit:Commit}).strict();
export const Pointer = z.object({schemaVersion:z.literal(3),channel:Channel,current:ReleaseRef,previous:ReleaseRef.nullable(),activatedAt:z.string().datetime()}).strict();
export const PublishedMarker = z.object({schemaVersion:z.literal(3),channel:Channel,releaseId:Digest,docsCommit:Commit}).strict();

/** Storage keys. KV holds JSON under the `docs/` type prefix; R2 holds binary assets. */
export const KEYS = Object.freeze({
  objectsPrefix: 'docs/objects/',
  object: (sha256: string) => `docs/objects/${sha256}.json`,
  manifest: (releaseId: string) => `docs/releases/${releaseId}/manifest.json`,
  pointer: (channel: string) => `docs/channels/${channel}.json`,
  marker: (releaseId: string) => `docs/published/${releaseId}.json`,
});

export type ItemV3 = z.infer<typeof Item>;
export type ManifestV3 = z.infer<typeof Manifest>;
export type PageObjectV3 = z.infer<typeof PageObject>;
export type PointerV3 = z.infer<typeof Pointer>;
export type PublishedMarkerV3 = z.infer<typeof PublishedMarker>;
