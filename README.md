# cs.cheap docs

cs.cheap 的对外文档权威仓库。正文按**内容单元**存放：`content/<section>/<page>/` 下一个 `item.json`（元数据与流程状态）加 `en.mdx`、`zh-CN.mdx`、`ru.mdx`；英文为主稿，中文与俄文为译文。四个业务项目的固定 Git SHA 记录在 `baselines/`。

内容流程：**Git 单元 → CI 编译（一次编译、按频道投影）→ Workers KV（JSON 对象）+ R2（二进制资源）→ frontend 按频道读取**。仓库只有一个发布分支 `master`；单元的 `stage` 决定它进入哪个频道（`reviewed` 进 preview，`published` 进 preview 与 production）。正文、译文、导航变化不需要构建 frontend；新组件或不兼容契约变化需要先部署前端。

当前正文为 **93 个单元 × 3 种语言 = 279 页**，其中 55 个 API 参考单元由生成器从固定 API 版本生成。Fumadocs 工具链生成标题 ID、目录和搜索结构，Shiki 在编译时生成双主题代码高亮；前端不执行 MDX，也不在请求中深校验正文。

## 本地命令

Node 22（`engines` 限定 22.x），依赖由 package-lock.json 锁定。

```bash
npm ci
npm run check                 # typecheck + api:check + 两频道编译 + 合同测试
npm run docs:build            # 干净的已提交 checkout：以 HEAD 为 docsCommit 生成可发布的 dist/
npm run api:generate          # 从 openapi/ 投影重新生成 API 参考单元；api:check 只比对不写
npm run test:kv -- --prefix test/<run-id>/                              # 真实 KV 适配器验收
DOCS_ALLOW_LOCAL_PUBLISH=1 npm run test:publish-local -- --prefix test/<run-id>/   # 真实 KV/R2 激活验收
```

`npm run check` 里的构建用全零 docsCommit，发布器拒绝该产物。`dist/` 每次构建先清空，内容为 `preview/manifest.json`、`production/manifest.json`、`objects/<sha256>.json`、`assets/<sha256>/<file>` 与 `build.json`。两个真机验收脚本只写 `test/<run-id>/` 前缀并在结束时删除，需要本地 `.env` 提供两项凭证（见 `.env.example`）。

## 内容单元

```text
content/<section>/<page>/
  item.json     # 所有语种共享的元数据与流程状态
  en.mdx        # 主稿；frontmatter 只有 title、description
  zh-CN.mdx     # 译文；frontmatter 另带 sourceDigest
  ru.mdx
```

`item.json`（strict，未知键即构建失败）：

| 字段 | 规则 |
| --- | --- |
| `schemaVersion` | 固定 `3` |
| `docId` | 全仓唯一（包括未进任何频道的单元）；`[a-z0-9]` 段以 `.` 或 `-` 分隔 |
| `slug` | 必须等于目录相对 `content/` 的路径 |
| `kind` | `tutorial` / `how-to` / `reference` / `explanation` |
| `stage` | `draft` / `reviewed` / `published` / `held` / `retired` |
| `deprecated` | 可选布尔，默认 false |
| `sources` | 非空、无重复：`spider` / `refinery` / `api` / `frontend` |
| `generated` | 可选；`true` 表示由 `npm run api:generate` 生成，不得手改正文 |
| `workflow` | 非空数组，只追加。每项 `{ stage, by, at, note? }`：`by` ∈ `human` / `claude-code` / `grok` / `chatgpt` / `claude`；`at` 为 RFC 3339 UTC、以 `Z` 结尾；`note` ≤ 500 字。`at` 单调不减，末项 `stage` 必须等于顶层 `stage` |

`stage` 与频道：

| stage | preview | production |
| --- | --- | --- |
| draft、held、retired | 否 | 否 |
| reviewed | 是 | 否 |
| published | 是 | 是 |

不在频道内的单元仍被解析、校验并参与 docId 唯一性。`retired` 不自动生成重定向，需要跳转时在 `redirects.json` 显式写。`navigation.json` 必须按 slug 列出每一个单元（含未进频道的）；不在频道内的条目在该频道被跳过，引用不存在的 slug 则构建失败。

语种文件 frontmatter 只有 `title`（≤200）与 `description`（≤400）；译文另带 `sourceDigest: sha256:<en.mdx 整个文件（含 frontmatter）的 sha256>`，英文不得带。摘要不等于当前 `en.mdx` 的译文视为过期：该语种页不进频道，`translations` 无该项，访问时 307 到英文页；构建只记录警告，不失败。

正文规则：

- 站内链接写 `/docs/<slug>`（不带语种）；编译器按频道解析为 `/{locale}/docs/<slug>`，目标译文缺失或过期时改写为英文路径；锚点必须存在于目标页目录。
- **链接目标必须与源页在同一频道**：`published` 页链接到 `reviewed` / `draft` / `held` / `retired` 单元会使 production 构建失败（错误列出 `源页 → 目标 slug`）；要么一起发布，要么去掉链接。
- 资源只能用仓级 `assets/` 中的文件，以 `/assets/<file>` 引用；没有单元级资源目录，单元目录里出现 `item.json` 与三个语种文件以外的任何文件都失败。
- 只允许 `<Callout type="info">` / `<Callout type="warning">`（可选 `title`）一种组件；不允许 ESM、表达式、原始 HTML、H1、脚注、任务列表、数学公式。
- 上限：`item.json` 64 KiB，编译后单页对象 256 KiB。

新单元从 `templates/unit/` 复制。`item.json` 的键序、两空格缩进与末尾换行由 `scripts/unit.mjs` 固定，生成器与检查脚本都用它；手写时保持同样格式。

## 代理写入契约

Grok / ChatGPT / Claude 等代理直接向 `master` 写单元，两种方式等价：

1. GitHub contents API：`GET /repos/cscheap/docs/contents/<path>` 取当前 `sha` → `PUT` 同路径并带上该 `sha`（新文件不带）→ 返回 409 时重新 `GET` 再 `PUT`。一次流程推进至少同时写 `item.json`（追加 `workflow` 条目并改 `stage`）与相应 `.mdx`。
2. `git push` 到 `master`。

每次推送到 `master`：CI 先 `npm run check`，再构建两频道并激活。校验失败（见上文规则）则两个频道都不发布，推送者修正后再推；PR 只校验、不发布；没有人工审批闸。

## 发布环境

一个 KV 命名空间 `cscheap-content`（id `9157dfb0aad643ff8451ef992eb9c64a`）与一个 R2 桶 `cscheap-content`，预览与生产是其中的两个频道，docs 使用键前缀 `docs/`。CI 只读两项仓库 Secrets：`CSCHEAP_DOCS_CF_ACCOUNT_ID`、`CSCHEAP_DOCS_CF_API_TOKEN`。回滚在 Actions 的 Run workflow 中选频道与 releaseId。细节见[发布与回滚](docs/architecture/publishing.md)与[发布操作](docs/architecture/release-operations.md)。

前端读取端按 `scripts/reader-model.mjs` 移植，是独立任务；读取端上线前线上文档停在最后一版 v2 内容。

## 阅读入口

| 文档 | 用途 |
| --- | --- |
| [架构总览](docs/architecture/README.md) | 边界与内容链路 |
| [仓库目录](docs/architecture/repository-layout.md) | 源码、生成产物和维护资料 |
| [用户文档目录](docs/architecture/information-architecture.md) | 栏目和页面归属 |
| [内容契约 v3](docs/architecture/content-contract.md) | 单元、item.json、正文树、多语言、链接与资源 |
| [编辑流程](docs/architecture/editing.md) | stage 流转、workflow 日志、代理写入 |
| [发布与回滚](docs/architecture/publishing.md) | 键布局、频道、激活算法、一致性模型与读取协议 |
| [发布操作](docs/architecture/release-operations.md) | 命令、Secrets、Actions、回滚、本地验收 |
| [贡献指南](CONTRIBUTING.md) | 事实来源与编写规范 |
| [内容契约 v3 决策](docs/decisions/0006-content-contract-v3.md) | 为什么按页拆分、KV 交付、stage 分频道 |

对外目录仍为 get-started、concepts、guides、api、billing、dashboard、support。项目名称只用于维护责任与来源追踪。
