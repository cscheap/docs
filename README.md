# cscheap docs

cs.cheap 对外文档的权威内容仓库。在跨项目文档合并流程建立前，由当前一个 AI 统一读取 spider、refinery、API 和 frontend 的现状，在本仓编写、复核和维护全部用户正文。

网站继续由 `cscheap-frontend` 的 Fumadocs 页面承载，改为运行时读取版本化内容包。TinaCMS 负责 Git 编辑；docs CI 从固定 Git SHA 编译结构化正文并发布到 R2。CMS 配置和后台留在本仓，前端不依赖 CMS 实时索引。

正文以 **英文为基准，简体中文和俄文为翻译**。网站继续使用 `/{locale}/docs/...`，兼容现有 `get-started/introduction` 地址（重定向到对应语言 docs 根）。

## 当前阶段

**范围更新**：首版以[当前范围](docs/architecture/v1-scope.md)为准：结构、规范、当前版本完整正文、Git SHA 基线、CMS 发布与前端动态读取。正文更新不触发 frontend 构建；新增组件或内容模型变化可能需要部署前端。

已建立 **49 个主题 × 3 种语言 = 147 页**，包含从固定 API 代码导出的 13 个公开/用户接口。四项目 SHA 已完成事实复核。离线编译器、严格节点契约、导航/链接/翻译校验、内容包发布器、回滚与 CI 配置已实现；验证记录见 [本轮验收](docs/references/validation-2026-10-09.md)。

正文与流水线随本仓 Git 版本维护；master 提交会执行文档校验。TinaCloud 三语集合查询已验证，编辑器登录和 Git 写回待验收。R2 自动发布开关尚未启用，等待专用桶凭证、GitHub → Infisical 身份接入及前端 reader 实施。前端计划与证据位于其 `.ai/2026-10-09/docs-cms-runtime-poc/`。

## 本地命令

Node 22.22.3，依赖由 package-lock.json 锁定。

```bash
npm ci
npm run check          # 类型、API 生成一致性、147 页编译、合同测试
npm run cms:dev        # Tina 编辑器开发
npm run docs:build     # 只允许干净的已提交 checkout，生成可发布包
```

普通 `docs:check` 生成 `dist/` 本地预览，docsCommit 为全零，发布器明确拒绝它。首版没有图片或视频；assets/ 中三个 JSON 为三语公开 OpenAPI 下载文件。线上配置与回滚见 [发布操作](docs/architecture/release-operations.md)。

## 阅读入口

| 文档 | 用途 |
| --- | --- |
| [架构总览](docs/architecture/README.md) | 职责边界与实施顺序 |
| [仓库目录](docs/architecture/repository-layout.md) | 本仓、上游仓库和生成产物的布局 |
| [用户文档目录](docs/architecture/information-architecture.md) | 栏目、页面、负责人和发布批次 |
| [内容契约](docs/architecture/content-contract.md) | MDX、元数据、链接、资源、多语言与 OpenAPI |
| [CMS 与发布](docs/architecture/publishing.md) | Git 基线、内容包、激活、预览与回滚 |
| [CMS 初始化](docs/architecture/cms-setup.md) | 本地运行、Infisical 配置与 TinaCloud 首次索引 |
| [贡献指南](CONTRIBUTING.md) | 修改应落在哪个仓库 |
| [架构决策](docs/decisions/0003-cms-editor-and-immutable-publication.md) | 当前 CMS 方向与待验证边界 |
| [官方参考](docs/references/2026-10-09.md) | 2026-10-09 核对的规范与适用边界 |

## 对外目录

```text
get-started/   开始使用
concepts/      核心概念
guides/        操作指南
api/           API 指南与生成的接口参考
billing/       计费与套餐说明
dashboard/     控制台操作
support/       问题排查与支持
```

页面以用户要理解的概念和要完成的任务组织。项目名称只用于维护责任和来源追踪。
