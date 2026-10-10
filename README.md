# cs.cheap docs

cs.cheap 的对外文档权威仓库。正文集中在 `content/`，英文为主，简体中文和俄文为翻译；四个业务项目的固定 Git SHA 记录在 `baselines/`。

内容流程：**AI 编辑 Git MDX → docs CI 编译 v2 内容包 → R2 不可变发布 → frontend 动态读取**。网站继续使用 `cscheap-frontend` 的 Fumadocs 页面。正文、翻译与导航更新无需重新构建 frontend；新组件或不兼容契约变化需要先部署前端。

当前正文为 **49 个主题 × 3 种语言 = 147 页**，包含固定 API 版本的 13 个公开/用户接口。Fumadocs 工具链统一生成标题 ID、目录和搜索结构，Shiki 在编译时生成双主题代码高亮；前端不执行 MDX。

## 本地命令

Node 22.22.3，依赖版本由 package-lock.json 锁定。

```bash
npm ci
npm run check          # 类型、API 生成一致性、147 页编译、合同测试
npm run docs:build     # 干净的已提交 checkout，生成真实 SHA 的正式包
```

普通 `docs:check` 生成 `dist/` 预览，docsCommit 为全零，发布器拒绝该包。首版只有三个公开 OpenAPI JSON 下载资源，没有图片或视频。

## 发布环境

`preview` 提交自动发布到 `preview-cscheap-docs`，`master` 提交自动发布到 `cscheap-docs`。桶名固定在代码中；CI 只读取三项仓库 Secrets，无需 GitHub Environment 或 Variables。PR 只校验；正常流程为独立 PR → preview 验收 → 合入 master。

发布时 CI 从事件 SHA 构建正式包，并读回验证 R2 产物与指针；frontend v2 reader 的端到端接入另行验收。历史本地验证见[验证记录](docs/references/validation-2026-10-10.md)，配置与操作见[发布操作](docs/architecture/release-operations.md)。

## 阅读入口

| 文档 | 用途 |
| --- | --- |
| [架构总览](docs/architecture/README.md) | 边界与内容链路 |
| [仓库目录](docs/architecture/repository-layout.md) | 源码、生成产物和维护资料 |
| [用户文档目录](docs/architecture/information-architecture.md) | 栏目和页面归属 |
| [内容契约 v2](docs/architecture/content-contract.md) | MDX、正文树、多语言、链接与资源 |
| [编辑流程](docs/architecture/editing.md) | AI / Git / PR 维护 |
| [发布与回滚](docs/architecture/publishing.md) | 版本、激活、并发与前端读取 |
| [发布操作](docs/architecture/release-operations.md) | GitHub 与 Infisical 配置 |
| [贡献指南](CONTRIBUTING.md) | 事实来源与编写规范 |
| [编译工具链决策](docs/decisions/0004-drop-tina-fumadocs-toolchain.md) | v2 编译工具链选择 |
| [分支发布决策](docs/decisions/0005-branch-based-r2-publication.md) | preview / master 与仓库 Secrets |

对外目录仍为 get-started、concepts、guides、api、billing、dashboard、support。项目名称只用于维护责任与来源追踪。
