# 内容契约 v3

精确契约位于 `contracts/schema.ts`（`zod/v3` 兼容入口），导出源侧 `Item`、`WorkflowEntry`、`LocaleFrontmatter`、`Baseline`，发布侧 `PageObject`、`SearchIndex`、`Manifest`、`Pointer`、`PublishedMarker`，以及 `LIMITS`、`KEYS`、`CHANNEL_STAGES`。正文节点（`AstNode` / `Root` / `CodeBlock` / `StructuredData`）与 `safeUrl` 自 v2 原样保留。Git 是正文来源，前端只读取通过摘要核对的 KV 对象。

## 内容单元

```text
content/<section>/<page>/
  item.json        # 单元元数据（所有语种共享）
  en.mdx           # 主稿；frontmatter: title, description
  zh-CN.mdx        # 译文；frontmatter: title, description, sourceDigest
  ru.mdx
```

单元目录里只允许这四个文件名，不允许子目录、符号链接或其他文件。`en.mdx` 必填，译文可缺。

### item.json

```jsonc
{
  "schemaVersion": 3,
  "docId": "api.reference.account.get-account",   // 全仓唯一（含未进频道的单元）
  "slug": "api/reference/account/get-account",     // 必须等于目录相对 content/ 的路径
  "kind": "reference",                              // tutorial | how-to | reference | explanation
  "stage": "published",                             // draft | reviewed | published | held | retired
  "deprecated": false,                              // 可选，默认 false
  "sources": ["api"],                               // 非空、无重复：spider | refinery | api | frontend
  "generated": true,                                // 可选；true = 由生成器生成，不得手改正文
  "workflow": [                                     // 非空、只追加
    { "stage": "published", "by": "claude-code", "at": "2026-11-04T08:00:00Z", "note": "migrated from v2" }
  ]
}
```

- `workflow[].by` ∈ `human | claude-code | grok | chatgpt | claude`；`at` 为 RFC 3339 UTC、`Z` 结尾（可带 ≤3 位小数秒）；`note` 可选、≤500 字。相邻条目 `at` 单调不减；末项 `stage` 必须等于顶层 `stage`。
- 对象 strict，未知键失败。`item.json` ≤ 64 KiB。
- 以下情况一律**构建失败**而不是排除：`item.json` 不合法、`workflow` 为空或末项不符、`slug` 与目录不一致、缺 `en.mdx`、英文带 `sourceDigest`、译文缺 `sourceDigest`、`docId` 重复、`navigation.json` 引用不存在的 slug、单元未列入 `navigation.json`。

### 语种文件

frontmatter 只有 `title`（1–200）、`description`（1–400）；译文另带 `sourceDigest: sha256:<en.mdx 整个文件（含 frontmatter，UTF-8 / LF）的 sha256>`，英文不得带。文件用 LF，不允许 `\r`。`scripts/unit.mjs` 固定 `item.json` 键序与 `.mdx` frontmatter 的序列化，生成器、迁移脚本与检查都用它。

译文 `sourceDigest` ≠ 当前 `en.mdx` 摘要 → 该语种页**过期**：不进任何频道、`translations` 无该项、自动 307 到英文；构建记录警告 `Excluded stale translation`，不失败。

### stage 与频道

| stage | preview | production | 说明 |
| --- | --- | --- | --- |
| draft | 否 | 否 | 仍解析、仍校验、仍参与 docId 唯一性 |
| reviewed | 是 | 否 | |
| published | 是 | 是 | |
| held | 否 | 否 | 人工拦停，处理同 draft |
| retired | 否 | 否 | 不自动生成重定向；需要跳转时在 `redirects.json` 显式写 |

介绍页（`get-started/introduction`，即 `/docs` 根）在任一频道缺席，或频道页集为空 → 该频道构建失败。

## 编译与正文边界

解析使用 unified 11 / remark-parse 11 / remark-gfm 4 / remark-mdx 3；Fumadocs 16.7.9 的 remarkHeading 与 remarkStructure 生成 TOC、标题 ID 和 structuredData。Shiki 4.2.0 在编译时使用 github-light / github-dark 双主题高亮。每页正文只编译一次，频道投影前深拷贝 AST，两频道不共享可变节点。

正文树只允许四种节点，与 v2 相同：

- Text：`{ type: 'text', value }`。
- Element：受限 hast 形状，允许基本 Markdown、h2–h6、列表和表格。属性按标签严格校验；标题必须有 id，链接只有 href/title，图片只有 src/alt/title。
- CodeBlock：语言、可选 title、最多 64 项双主题颜色调色板及 `[文本, 颜色下标]` 行 token；`-1` 代表无色，拼接后保留原始代码文本。未知语言作为 text 输出并记录 warning。
- Component：仅 Callout，属性只允许字面量 type（info / warning）和可选 title；内容位于 children。

节点最大深度 64；不保留 position、空 properties 或块元素间的纯空白。颜色严格限定十六进制值，任意标签、事件、style/className、外部图片均拒绝。ESM、MDX 表达式、原始 HTML、H1、任务列表、脚注、数学语法同样拒绝。代码围栏只支持 `title="…"` 元数据；标题 ID 直接使用 Fumadocs 的 github-slugger 结果，自定义 `[#id]` 必须合法且唯一。

每页 `structuredData` 包含 `headings: {id, content}[]` 和 `contents: {heading?, content}[]`。

## 链接、重定向与资源

源码内部链接写 `/docs/<slug>`（或显式语种路径）；编译期按频道解析目标并输出 `/{locale}/docs[/slug][#id]`：

- 目标单元**不在本频道**（draft / held / retired，或 production 中的 reviewed）→ 本频道构建失败，错误列出 `源页 → 目标 slug`。不降级、不留 404。
- 目标单元在频道内、目标语种缺席或过期 → href 改写为 `/en/docs/...`。
- 锚点必须存在于目标页（目标语种或回退后的英文页）的 TOC，否则构建失败。

源页对象的 sha256 会随目标页译文状态或 TOC 变化而变化，这是内容寻址的预期行为。

`redirects.json` 的显式条目：目标 slug 不存在于全仓 → 构建失败；目标在全仓但不在本频道 → 该条目在本频道丢弃并警告；不得遮蔽已有路由。自动重定向：介绍页 308 到 `/{locale}/docs`，缺译 307 到英文。

资源在仓级 `assets/` 中，以 `/assets/<file>` 引用；没有单元级资源目录。文件名只允许字母、数字、点、下划线和短横线；类型限 JSON、PNG、JPEG、WebP（按魔数核对），单个 ≤ 5 MiB；SVG 和远程图片不接受。编译器只把频道内页面引用的资源写入该频道 manifest 的 `assets`，键为 `assets/<sha256>/<basename>`。前端把 `/assets/<file>` 改写为 `/api/docs/assets/<releaseId>/<file>`，只能读取该版 manifest 登记的资源。

## 编译输出

每个频道一套，对象内容寻址、频道与版本共享：

| 类型 | 键 | 形状 | 上限 |
| --- | --- | --- | --- |
| PageObject | `docs/objects/<sha256>.json` | `{ schemaVersion: 3, docId, locale, slug, title, description, kind, deprecated, body, toc, structuredData }` | 256 KiB |
| SearchIndex | `docs/objects/<sha256>.json`（每频道每语种一个） | `{ schemaVersion: 3, channel, locale, pages: [{ id, title, url, structuredData }] }`，`pages` 与该频道该语种的 manifest 页集一致 | 1 MiB |
| Manifest | `docs/releases/<releaseId>/manifest.json`，`releaseId` = manifest 字节 sha256 | `{ schemaVersion: 3, channel, docsCommit, compiler, baselines, pages[], trees, translations, redirects, assets, search }`；`pages[].object` 与 `search.*` 为 `{ sha256, size }` | 1 MiB |
| Pointer | `docs/channels/<channel>.json` | `{ schemaVersion: 3, channel, current: { releaseId, docsCommit }, previous: … \| null, activatedAt }` | 16 KiB |
| PublishedMarker | `docs/published/<releaseId>.json` | `{ schemaVersion: 3, channel, releaseId, docsCommit }` | 16 KiB |
| 资源 | R2 `assets/<sha256>/<basename>` | 原始字节 | 5 MiB |

manifest 是对象类型的唯一出处：读取端按 `pages[].object` 用 PageObject 解析、按 `search.<locale>` 用 SearchIndex 解析。`manifest.baselines` 必须全部 `documentationReview: reviewed`。相同输入两次构建输出逐字节一致。

## 客户 API 内容

API 字段和结构来自 baselines/api.json 锁定 SHA 的公开导出，由 `scripts/api-reference.mjs` 生成 `content/api/reference/<group>/<name>/` 单元。筛选 hidden operation，并仅纳入 roles 为空或包含 user 的客户接口；管理员专用与机器专用端点排除，描述在「Administrators」小节处截断，`scope` 查询参数去掉。

生成器**拥有** `docId`、`slug`、`kind`、`sources`、`generated: true` 与三个 `.mdx` 全文（译文 `sourceDigest` 按上文规则计算）；`stage`、`deprecated`、`workflow` 若单元已存在则原样保留。新单元初始 `stage: draft`，`workflow` 一条 `{ stage: "draft", by: "claude-code", at: <baselines/api.json.capturedOn + "T00:00:00Z">, note: "generated from api baseline <commit 前 12 位>" }`，取基线日期而非当前时间，保证重复生成确定。`--check` 只比较生成器拥有的字段与文件。参考页路径由显式映射固定，不因函数名或 tag 改名改变 URL。
