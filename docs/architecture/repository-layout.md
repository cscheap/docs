# 仓库目录

正文集中在 docs。dist 是生成结果，.cache 是本地证据与临时输入，.ai 是任务过程产物；均不提交。

```text
docs/
├── README.md                     # 代理操作手册：单元、字段、频道、写入契约
├── AGENTS.md
├── CONTRIBUTING.md
├── content/                      # 内容单元：<section>/<page>/{item.json, en.mdx, zh-CN.mdx, ru.mdx}
│   ├── get-started/
│   ├── concepts/
│   ├── guides/
│   ├── api/                      # api/reference/<group>/<name>/ 由生成器生成（generated: true）
│   ├── billing/
│   ├── dashboard/
│   └── support/
├── navigation.json               # 分组标题（三语）+ 有序 slug 列表；每个单元必须列出
├── redirects.json                # 显式旧路径；禁止链式/悬空重定向
├── assets/                       # 仓级共享资源，正文以 /assets/<file> 引用
├── baselines/{spider,refinery,api,frontend}.json
├── openapi/{en,zh-CN,ru}.json + provenance.json   # 固定 API SHA 的客户范围导出
├── contracts/schema.ts           # v3 契约：Item、PageObject、Manifest、Pointer、PublishedMarker、LIMITS、KEYS
├── templates/unit/{item.json,en.mdx,zh-CN.mdx}
├── scripts/
│   ├── compile.mjs               # 读单元、编译一次、按频道投影
│   ├── mdx.mjs                   # compileBody（Fumadocs + Shiki）
│   ├── build.mjs                 # 写 dist/{preview,production}/manifest.json、objects/、assets/、build.json
│   ├── publish.mjs               # Actions 守卫入口：两频道 publish 或单频道 rollback
│   ├── publish-core.mjs          # 激活算法（对象 → manifest → 标记 → 指针）
│   ├── kv-store.mjs / r2-store.mjs / cf-api.mjs   # Cloudflare REST 适配（同一 token）
│   ├── store.mjs                 # prefixed() / openStores() / memoryStore()
│   ├── deployment.mjs            # 命名空间 id、桶名、分支守卫、凭证读取
│   ├── reader-model.mjs          # 读取协议参考实现（交接前端）
│   ├── api-reference.mjs         # API 参考单元生成器（--check / --from-openapi）
│   ├── unit.mjs                  # item.json / .mdx 的固定序列化与摘要
│   ├── export-api.py             # 从 API 仓固定 SHA 导出 OpenAPI
│   ├── publish-local-test.mjs    # 真机激活验收，仅 test/<run-id>/ 前缀
│   └── kv-store.integration.mjs  # 真机 KV 适配器验收
├── tests/                        # 契约、频道投影、限额、发布器、KV 适配器、读取模型等合同测试与夹具
├── dist/                         # 构建产物，不提交
├── package.json                  # 内容编译工具，锁定实际验证版本
├── .env.example                  # 两项凭证名
├── .github/workflows/docs.yml    # PR 校验、push master 激活、workflow_dispatch 回滚
└── docs/                         # 维护设计，不作为用户正文加载
    ├── architecture/
    ├── decisions/
    └── references/
```

## 编译器与 frontend

`content/` 是唯一正文目录。`scripts/mdx.mjs` 编译正文，`scripts/compile.mjs` 校验单元、译文、导航、链接和资源，每页编译一次后按频道投影出页面对象、搜索索引与 manifest。`docs/`、`baselines/`、`templates/` 不作为正文加载。

frontend 保存同一 Zod 契约、读取协议（按 `scripts/reader-model.mjs` 移植）与组件实现，不在请求中编译 MDX 或运行 Shiki，也不深校验正文。内容修改只产生新的 KV 对象与 manifest；renderer 代码或契约变化才部署应用。

frontend 目标变化范围（下一任务）：

```text
lib/docs/                          # 指针 → manifest → 单页 的读取、契约、树与搜索
components/docs/                   # 静态 AST → 现有 React 组件（不变）
app/[locale]/docs/                 # 动态叶子页面及稳定外层
app/api/docs/                      # 按 releaseId 的搜索与资源路由（先做频道准入）
```

## 基线记录

每个 JSON 保存项目、仓库、完整 commit、核对日期和复核状态。GitHub 远端引用与本地 HEAD 已一致时记录 remote-ref-matches-local-head；不得把分支名本身当成版本。

`item.json.sources` 列出关联项目。编译要求所有基线 `documentationReview: reviewed`；manifest 记录 docs commit 与四项基线。
