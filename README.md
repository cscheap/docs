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

保留一个 `master` 发布分支。GitHub Environments `staging` / `production` 分别对应 R2 桶 `preview-cscheap-docs` / `cscheap-docs`。手动任务可选环境，启用自动发布后 master 更新生产。PR 校验不读取秘密；R2 凭证以 Infisical 为准，按既有构建模式复制到 GitHub Environment Secrets。

两桶与 S3 对象读写已验证；正式 CI 激活、GitHub Environment 接线和 frontend v2 reader 的端到端接入仍需联调。本地验证见[本轮记录](docs/references/validation-2026-10-10.md)，具体配置见[发布操作](docs/architecture/release-operations.md)，不能把本地预览视为线上版本。

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
| [当前架构决策](docs/decisions/0004-drop-tina-fumadocs-toolchain.md) | v2 编译工具链选择 |

对外目录仍为 get-started、concepts、guides、api、billing、dashboard、support。项目名称只用于维护责任与来源追踪。
