# 内容发布

流程为 **代理 → docs Git（单分支 master）→ CI 一次编译、按 stage 投影两个频道 → KV + R2 → frontend 按频道读取**。生产地址保持 `/{locale}/docs/...`，内容更新不触发 frontend 构建。

## 存储与键

一个 KV 命名空间 `cscheap-content`（id `9157dfb0aad643ff8451ef992eb9c64a`）和一个 R2 桶 `cscheap-content`，预览与生产 Worker 都绑定它们。频道隔离靠指针键和标记里的 `channel` 字段，不靠命名空间。docs 用键前缀 `docs/`；sites / blog 之后各用自己的前缀。

| 键 | 内容 | 可变性 |
| --- | --- | --- |
| `docs/objects/<sha256>.json` | PageObject 或 SearchIndex，内容寻址 | 不可变，永不删除 |
| `docs/releases/<releaseId>/manifest.json` | 一个频道的一个版本；`releaseId` = 字节 sha256 | 不可变 |
| `docs/published/<releaseId>.json` | 激活标记 `{ channel, releaseId, docsCommit }` | 不可变 |
| `docs/channels/<preview\|production>.json` | 频道指针 `{ current, previous, activatedAt }` | **唯一会被重写的键** |
| R2 `assets/<sha256>/<basename>` | 二进制资源 | 不可变 |

v3 只增不删（prune 是后续事项）；本地验收脚本的 `delete` 只用于 `test/<run-id>/` 前缀。

两个频道从同一提交各出一份 manifest。`published` 单元同时出现在两份 manifest 里且页面对象相同（sha 相同，只上传一次）；`reviewed` 单元只在 preview。

## CI 流程

```text
push master（或 PR）
  → npm run check：typecheck、api:check、两频道编译（校验 item.json、译文摘要、导航、链接、资源、基线）、合同测试
  → [仅 push master] npm run docs:build：HEAD 作为 docsCommit，写 dist/
  → [仅 push master] node scripts/publish.mjs：先 preview 后 production，各自激活
  → frontend 后续请求按其频道指针读取
```

PR 不接触发布凭证。任一频道**编译**失败 → 两个频道都不发布，退出非零。激活阶段两频道各自捕获错误：production 不因 preview 失败而跳过；任一频道 `failed-before-switch` 或 `unknown` → 作业退出非零，已切换的频道保持切换。

## 激活算法（`publish-core.activate`，按频道）

输入：`channel`、`mode: publish | rollback`、本地 `dist/<channel>/manifest.json` 与对象（publish）或目标 `releaseId`（rollback）、KV / R2 store、`head()`。

**publish 前置条件**：manifest 过 `Manifest` 解析且 `channel` 一致；`docsCommit` = HEAD = `GITHUB_SHA`，`dist/build.json` 非本地构建；本地每个对象 sha256 = 文件名且体积与 manifest 一致，资源字节与 manifest 一致。`head()`（重新 fetch `origin/master`）≠ `docsCommit` → `skipped-stale`，不写任何东西。当前指针（若存在）的 `docsCommit` 必须是新提交的祖先，否则拒绝。

**rollback 前置条件**：从 KV 读 `docs/releases/<id>/manifest.json`，字节 sha256 = id、过解析、`channel` 一致。资格二选一：(a) 指针路径——id 等于本频道指针的 `current` 或 `previous`，且指针记录的 `docsCommit` 等于 manifest 的；(b) 标记路径——`docs/published/<id>.json` 存在、可解析，且 `{ releaseId, docsCommit, channel }` 与 manifest 一致。否则拒绝，包括标记属于另一频道（禁止跨频道回滚）。不检查 HEAD。

**写序：对象 → manifest → 标记 → 指针**，每步 REST 回读确认已持久化后才进行下一步。

1. 远端对象：`list docs/objects/` 得已存在键集（list 可能滞后，重复上传相同内容无害）。publish：不存在的对象 `bulkPut`，随后**每个**引用对象逐个点读核 sha256 = 键、体积 = manifest 记录，不符即失败且不覆盖。资源：R2 `immutable`（已存在则比对字节，不同即失败；不存在则写入并回读）。最后 manifest `immutable` 写入。rollback：只点读验证全部对象与资源，缺失或不符 → 失败，不补传。
2. 切换前：publish 再次 `head()`，≠ `docsCommit` → `skipped-stale`（已上传对象留在 KV，无害；**不写标记**，该版本不具备资格）。重读指针，字节必须与步骤 0 读到的一致，否则失败（并发写者）；指针中 `current` / `previous` 的标记必须存在且身份一致，否则拒绝继续。
3. **写本版标记**（`immutable`：已存在则必须身份一致）。失败 → `failed-before-switch`，指针不动。
4. 目标已是 `current` → `already-current`。
5. 写指针 `{ current: new, previous: before.current, activatedAt }`，回读确认（见下文写后确认）。rollback 结果为 `rolled-back`，publish 为 `published`。

以上任一步在写指针之前失败 → `failed-before-switch`，指针不变。频道结果枚举：`published | already-current | skipped-stale | rolled-back | failed-before-switch | unknown`。

**标记先于指针**是核心不变量：一个版本能出现在指针里，当且仅当它的标记已持久化。写指针之后不再有可失败的步骤，不存在“切换成功但标记失败”的半完成态，也不需要跨运行修复。标记的语义是**激活记录**：该版本已为本频道完整上传并通过远端验证；指针 PUT 失败而标记已在的版本视同“已激活但未成为 current”，保有显式读取与回滚资格。

## 一致性模型

KV 是最终一致存储。方案**不**假设 REST 回读等于全球可见，**不**对传播时长作数值承诺，也不假设 `previous` 已被各地读者读过。协议只依赖：(i) 对象、manifest、标记键不可变、永不删除；(ii) 写者按上述顺序写，回读只用于排除写入丢失，不作为可见性屏障。2026-11-04 实测：KV 删除即使点读也最终一致，`list()` 可能滞后；协议不依赖删除。

**写后确认**（只针对指针键）：PUT 成功 → 回读；读到新值 → `published`。读到旧值或 null → 间隔 1 s 再读，最多 3 次；仍非新值 → `unknown`，退出非零，不再写。PUT 结果未知（超时 / 网络错误）→ 先回读，新值即 `published`；否则重试 PUT（内容幂等）最多 3 次，每次后同样确认；耗尽 → `unknown`。`unknown` 的含义：指针可能已切换也可能未切换，但标记已在，版本资格不受影响；下一次运行按自己读到的指针正常工作。

写前读到旧指针（陈旧前置读）不影响结果：后果只有 `previous` 链可能跳过一版，被跳过的版本仍有标记，保有显式读取与回滚资格。写指针前的“重读指针字节未变”是并发写者的尽力检测，互斥由 Actions 并发组 `cscheap-docs-activation` 保证。同键限速（1 写/秒）只影响指针键；适配器对 429 按 `Retry-After` 等待重试，最多 3 次，耗尽按“结果未知”处理。

## 读取协议（frontend）

参考实现 `scripts/reader-model.mjs`，前端照此移植到 KV binding。频道由环境变量选取（建议 `CSCHEAP_FRONTEND_CONTENT_CHANNEL=preview|production`，绑定名建议 `CSCHEAP_CONTENT_KV`、`CSCHEAP_CONTENT_BUCKET`）。

1. 读本频道指针，`cacheTtl: 60`。缺失、非法或 `channel` 不符 → `unavailable`。
2. 按 `current` 读 manifest（字节 sha256 = releaseId、过 `Manifest` 解析、`channel` = 本频道、`docsCommit` = 指针记录值）和所需对象（字节数 = `size`、sha256 = 键、过对应 schema）。任一不符 → **整版改用 `previous`**，同样规则；`previous` 不存在或也失败 → `unavailable`。一次请求内不混用两版。页在该版 manifest 中不存在 → 正常 404 / 重定向，不从 `previous` 救回。
3. **显式 releaseId 读取**（搜索、资源路由 `/api/docs/assets/<releaseId>/<file>`）：manifest 字节 sha256 = 请求 id、`channel` = 本频道，且 (a) id 等于本频道指针的 `current` 或 `previous` 并且指针记录的 `docsCommit` = manifest 的，或 (b) 存在本频道标记且 `{ releaseId, docsCommit, channel }` 与 manifest 一致。任一不满足 → 404，不返回内容、不改用其他版本（含“只上传无标记”与“另一频道的版本”）；合格但对象缺失 → 404。
4. `cacheTtl`：指针 60 s；manifest、对象、标记一律 **30 s**（最小值），因为 KV 对“未找到”也按 `cacheTtl` 负缓存，长 TTL 会把传播中的新键在该机房钉死为缺失。命中后的对象由 isolate 内 LRU 保留（内容寻址键不变，可无限期保留），30 s 只影响未命中路径的回源频率。
5. **可用性承诺（只承诺行为，不承诺时限）**：读者在任何时刻要么返回某一个完整版本（`current` 或 `previous`），要么 `unavailable`；绝不混版、绝不返回摘要不符的对象。首次发布后、以及连续发布间隔短于传播时间时可能 `unavailable`，持续到任一版本在该机房可见为止。旧指针被边缘缓存最多 60 s 只意味着晚看到新版。

运行时校验范围：指针与 manifest 过 zod；单页只核 sha256 = 键、体积与顶层字段浅校验，正文不深校验；前端用节点白名单渲染，绝不执行内容中的代码或 HTML。

## 回滚

Actions → Documentation → Run workflow：`mode=rollback`，选 `channel`（preview / production），`release` 填该频道已激活过的完整 64 位 releaseId。回滚是独立 job，不依赖当前正文能否构建；只调整所选频道的指针，原 `current` 变成 `previous`，不改 Git。之后 `master` 的新提交仍会自动发布；永久撤销内容应通过 Git（把单元改为 `retired` / `held` 或回退正文）。不允许跨频道回滚；整个命名空间不可用时，`previous` 不是灾备。操作细节见[发布操作](release-operations.md)，设计依据见 [ADR 0006](../decisions/0006-content-contract-v3.md)。
