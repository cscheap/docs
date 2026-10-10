# 内容发布

首版流程为 **AI → docs Git → 固定 SHA 内容编译 → R2 发布 → frontend 动态读取**。生产地址保持 `/{locale}/docs/...`，内容更新不触发 frontend 构建。

## 编辑与分支

正文通过 Git 分支和 PR 编辑，master 是唯一发布来源；staging / production 是 GitHub Environments，不需要额外 preview 分支。两环境分别写 preview-cscheap-docs / cscheap-docs。

## CI 流程

```text
独立 docs PR
  → 校验元数据、MDX、翻译摘要、导航、链接、资源、来源 SHA、公开 API 范围
  → 合入 master
  → checkout 本次事件完整 SHA
  → 离线解析/生成正文树 + 编译期高亮 + TOC + 树 + structuredData + 有效语言 + 基线
  → 上传不可变资源及内容包，读回并验证摘要/schema
  → 串行激活一个发布指针
  → frontend 后续请求读取已发布版本
```

PR 校验不拿生产写凭证。独立变化保持独立 PR，不自动把不同项目的变更汇总；每个项目基线文件单独维护，跨领域页面同时复核依赖 SHA。

内容发布是数据构建，不是 Next/Workers 应用构建。没有 frontend repository_dispatch，也没有通过 revalidateTag 刷新只读静态缓存的前提。

## 版本契约

内容包记录 schemaVersion、rendererContract、docsCommit、编译器和实际工具链版本、四项目 baselines，以及发布集合。包外 SHA256 为 releaseId，直接关联包的确定字节。

正文、导航、TOC、搜索、语言映射、重定向和资源索引由同一输入快照产生。ready/deprecated 且事实复核通过的页面可以发布；草稿、过期译文及未公开 API 不进入公共包。baselines 的 pending 不能因捕获 SHA 自动变成 reviewed。

首版使用受限单 JSON 包：指针 16 KiB、包 8 MiB、单页 256 KiB 的上限由编译器和发布器校验。包和资源放 `releases/<releaseId>/bundle.json` / `assets/<sha256>/<filename>`；`channels/current.json` 记录 current/previous。图片随内容发布，不复制到 frontend/public 后重建。

## 并发、激活和回滚

上传并验证完整产物后才切指针，任何前置失败保持旧版本。所有激活与回滚共用一个 GitHub Actions concurrency group，禁止第二个未受管的写入口。concurrency 不是 FIFO；激活前还需核对 master 目标和已发布 SHA 的祖先关系，旧任务/重跑不得覆盖新发布。回滚通过显式选择历史版本的同一串行流程。

R2 是 last-writer-wins，不能把对象存储当成自动去除乱序事件的服务。以后引入多写者前必须增加经过验证的条件更新/围栏。首版不自动删除历史 release，旧浏览器页面仍按其 release 搜索。显式版本读取仅允许 current/previous 或有历史激活记录的版本，不能通过猜测 hash 读取尚未激活的包；每次下一轮激活前补齐历史记录。

## frontend 读取

前端通过 R2 binding 读取，不持有 docs CI 的上传 key 。current 指针不走公共 CDN 缓存，每次服务端渲染在请求范围内选一次完整包，metadata/正文/页面树共用该快照；搜索与资源请求携带 releaseId。

新增路由不能仅依赖 generateStaticParams。共享布局在客户端导航可能不刷新，因此可变树/provider/外壳与正文统一由叶子 page 输出同一快照，并做完整 Next E2E 验证。法律页、web3、changelog 与其他页面保持现有内容源及缓存。

未知 schema、摘要错误、超限等可以回退完整 previous；current 中确实删除的页正常 404/重定向，不能从历史救回。pointer 或整个 R2 不可用不保证有持久旧缓存；API 返回 503，SSR 显示明确不可用与重试，真实流式状态在 Next 实测，不虚报固定 503。

## 接入凭证与状态

本地 PoC 已完成，完整前端改造 plan、接口和原始输出在 frontend `.ai/2026-10-09/docs-cms-runtime-poc/`。

发布所需四个 R2 键在 Infisical 对应环境 `/cscheap/docs`。frontend 用原生 binding，不接收上传凭证。staging 与生产暂共用用户提供的对象读写凭证，桶名仍分离。

前端改造交由用户安排的前端 AI。本仓 v2 编译器、CI、发布/回滚保持独立；GitHub 环境配置、正式激活及 frontend 接入仍需联调。操作见[发布操作](release-operations.md)，设计见[当前决策](../decisions/0004-drop-tina-fumadocs-toolchain.md)。
