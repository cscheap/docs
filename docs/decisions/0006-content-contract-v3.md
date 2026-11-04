# 内容契约 v3：按页拆分、KV 交付、stage 分频道、单分支

状态：2026-11-04 用户确认并实施（plan 评审 5 轮通过）。取代 [ADR 0005](0005-branch-based-r2-publication.md) 全部、[ADR 0004](0004-drop-tina-fumadocs-toolchain.md) 中的整包容器部分，以及 [ADR 0002](0002-git-cms-runtime-content.md) / [ADR 0003](0003-cms-editor-and-immutable-publication.md) 中与分支、Tina 相关的残余说明。0004 的编译工具链与正文节点契约继续有效。

## 背景

v2 把全部页面编译成一个 `bundle.json` 发到 R2（2026-10-27 起 6.4 MB，上限 8 MiB）。前端每个 docs 请求读指针 → 读整包 → sha256 → `JSON.parse` → zod 递归校验全部正文。isolate 级缓存命中率仅 1.1%（低流量、多机房），docs 页平均 3 s CPU、占生产 Worker CPU 58%，2026-11-01/02 出现 14 次 `exceededMemory`。根因是容器而非内容：正文 AST 契约与前端白名单渲染器没有问题。

用户同时要把 sites / blog 改成「文档即真相、Git 即 CMS、AI 代理分阶段推进」的模式：Grok 定时采集写稿、ChatGPT 审核翻译、Claude 终审发布，不要人工审，代理用各自定时任务直接写仓。docs 是第一个验证对象，单元形状与状态机要三类内容通用，但本决策只实施 docs。

## 决定

1. **内容单元**：`content/<section>/<page>/{item.json, en.mdx, zh-CN.mdx, ru.mdx}`。`item.json` 持有 `docId`、`slug`、`kind`、`stage`、`deprecated`、`sources`、`generated` 与只追加的 `workflow` 日志（`by` ∈ human / claude-code / grok / chatgpt / claude）。译文以整份 `en.mdx` 的 `sourceDigest` 标记来源；`translationOf` 删除。没有单元级资源目录。
2. **单分支 + stage 分频道**：只有 `master`。`reviewed` 进 preview，`published` 进 preview 与 production，`draft` / `held` / `retired` 不进任何频道但仍被校验。契约失败（workflow 不合法、slug 不符、docId 重复、缺英文等）一律构建失败。`published` 页链接到频道外单元使该频道构建失败（用户裁决：逼作者一起发布，不降级）。
3. **每频道一份 manifest，内容寻址对象**：每页编译一次、按频道投影。页面对象与搜索索引按 sha256 存 KV `docs/objects/`，manifest 存 `docs/releases/<releaseId>/`，`releaseId` = manifest 字节 sha256。上限：单页 256 KiB、搜索索引 1 MiB、manifest 1 MiB、item 64 KiB、指针与标记 16 KiB、资源 5 MiB。
4. **KV + R2，单命名空间单桶**：JSON 进 KV `cscheap-content`，二进制进 R2 `cscheap-content`；预览与生产是同一存储里的两个频道，docs 用键前缀 `docs/`，sites / blog 之后用各自前缀。两者都走 Cloudflare REST API，同一个 API token；CI 只需 `CSCHEAP_DOCS_CF_ACCOUNT_ID` 与 `CSCHEAP_DOCS_CF_API_TOKEN`，不再有 S3 凭证与 SDK。
5. **标记先于指针**：写序固定为对象 → manifest → 激活标记 → 频道指针，每步回读。一个版本出现在指针里当且仅当其标记已持久化；写指针后没有可失败步骤，不存在半完成激活，v2 的跨运行标记修复逻辑删除。标记语义是「已为本频道完整上传并通过验证」，指针 PUT 结果未知的版本保有显式读取与回滚资格。
6. **运行时不深校验**：前端一次请求只读指针、manifest 与当前一页；指针与 manifest 过 zod，单页只核 sha256 = 键、体积与顶层字段。
7. **最终一致模型，只承诺行为**：不假设 REST 回读等于全球可见，不对传播时长作数值承诺。读者任何时刻要么返回某一个完整版本（current 或 previous），要么 `unavailable`；绝不混版、绝不返回摘要不符的对象。显式 releaseId 读取只接受本频道 current / previous（docsCommit 一致）或带本频道标记的版本，其余 404。指针 `cacheTtl` 60 s，不可变键 30 s（KV 负缓存会钉死传播中的新键）。指针写后确认 3 次读不到新值 → `unknown`，退出非零，不再写。
8. **v3 不做 prune**：对象、manifest、标记永不删除，这是一致性论证的前提。
9. **两频道编排**：构建阶段任一频道失败则都不发布；激活阶段先 preview 后 production、各自捕获错误，任一失败退出非零。回滚按频道、独立 job、不依赖当前正文能否构建，禁止跨频道。
10. **无损迁移**：从 `f11a521a0dcd32636ad04495414f207f38657451` 迁入 93 单元 / 279 页，全部 `published`，有效译文摘要重算；迁移脚本一次性、不入库。API 参考生成器改为生成单元，拥有 docId / slug / kind / sources / generated 与三个 mdx，保留 stage / deprecated / workflow，新单元以 API 基线日期作初始时间戳以保持确定性。

## 一致性论证摘要

对象、manifest、标记不可变且永不删除 (8)，加上写序 (5)，使得「指针引用的版本一定有标记、一定有完整对象」在写者视角恒成立。读者看到的可能是旧指针、或新指针但部分对象尚未可见：前者只是晚看到新版，后者由读取协议整版退到 previous 或报 `unavailable` (7)。写前陈旧读只造成 previous 链跳版，被跳版本凭标记保有资格。可见性时限不由本方案承诺；可测试的参考实现 `scripts/reader-model.mjs` 与内存 store 的「延迟可见」注入覆盖这些场景。

## 影响

- 前端一次 docs 请求的工作量从「整包解析 + 全量校验」降为「三次 KV 读 + 一页校验」；搜索与资源路由按 releaseId 读，先做频道准入。
- 没有预览分支与生产分支的合并流程；预览内容由 `stage` 控制，无人工闸。CI 校验失败即两频道都不发布，作者必须修正。
- `published` 页只能链接 `published` 单元，发布一组互相引用的新页要同时推进 stage。
- 过渡期：docs 切到 v3 后不再发 v2 整包，前端读取端上线前线上文档冻结在最后一版 v2，不保留热修复通道（用户接受）。
- 与 CI 配合的凭证减少为两项；KV 存储增长只增不减。

## 后续事项

- **prune**：按「不被任何指针 / 标记引用且早于某时间」回收对象与 manifest，需在读取协议上补充删除语义后再做。
- **sites / blog 复用**：同一单元形状、stage 状态机、写序与读取协议，各自键前缀；blog 私有 = 藏过程，内容照常公开。
- **共享工具抽取**：`kv-store` / `r2-store` / `cf-api` / `store` / `publish-core` / `reader-model` 在第二个内容仓出现时抽成共享包。
- **前端读取端**:2026-11-04 已上线(前端提交 `da18d3b`,前端 ADR 0068):按 `scripts/reader-model.mjs` 移植,绑定 `cscheap-content` KV 与 R2,频道由 `CSCHEAP_FRONTEND_CONTENT_CHANNEL` 选取(预览 Worker `preview`、生产 Worker `production`),两环境部署后验收通过。随后已删除旧桶 `preview-cscheap-docs` / `cscheap-docs` 与 Infisical `/cscheap/docs` 的 `CSCHEAP_DOCS_R2_*`;GitHub Repository Secrets `CSCHEAP_DOCS_R2_*` 与对应 S3 凭证待用户手动删除。
