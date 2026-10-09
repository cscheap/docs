# 2026-10-09 首版实现验证

本记录描述提交前的本地验证结果。验证时正文尚未提交，远端 master 为 Tina 初始化 `234884df0ad4ace987f53361c0ba52cce669bc87`；随后正文与流水线的提交以本仓 Git 历史为准。此记录不代表已创建 R2 桶、启用线上发布或部署 frontend。

## 已完成

| 项目 | 结果 |
| --- | --- |
| 当前正文 | 49 个主题 × en/zh-CN/ru，共 147 页；无发布草稿或过期译文警告 |
| 固定业务版本 | 四个 git archive 输入；事实复核见 current-baseline-review.md；baselines 均 reviewed |
| API 范围 | 13 个匿名/普通用户操作 × 三语；模型引用完整、跨语言结构一致；排除管理/同步操作 |
| 内容包 | 2,761,797 UTF-8 bytes，低于 8 MiB；每页低于 256 KiB |
| 资源 | 三个公开 OpenAPI JSON，无图片或视频；仅有效页面引用的资源可发布 |
| 完整检查 | `npm run check` 退出码 0，37 个测试通过，0 失败/跳过 |
| 渲染 | 147 页由真实 StaticTinaMarkdown + ReactDOMServer 渲染，逐一校验 TOC 对应的 DOM id |
| Tina config/lock | 类型检查及 schema 字段一致性验证通过 |
| 前端 Zod 兼容 | 使用 frontend 实际安装包的 zod/v3 入口验证完整包通过；未修改其依赖 |
| Tina 后台本地构建 | 2560 MiB 堆上限，退出码 0 |
| Tina 正式云端构建 | 既有 Infisical 只读凭证、未跳过 cloud checks，退出码 0；后台 artifact 凭证扫描通过 |
| 候选文件凭证扫描 | 201 个候选文件未发现已提供的 Tina token 或管理员凭证值 |
| CI 配置 | 两个 workflow 的 YAML 解析通过，Actions 固定官方 tag 对应完整 SHA；未在线执行工作流 |
| 生产构建保护 | 当前脏工作区执行 `--release` 被拒绝，普通终端直接发布被拒绝，均符合预期 |

本地内容包 releaseId 为 `3613ab8581466548302b7bd04ac00170424970f17fa0dcf783b665b2db0be87d`，docsCommit 是全零，preview=true。它是联调输入，不是已发布版本，也不假装对应初始化提交。正式提交会产生不同 releaseId。

## 合同测试覆盖

确定性构建，147 页三语与静态渲染，重复/行内代码/中文/俄文/Callout 内标题，过期译文从正文、树、搜索和语言映射排除，草稿资源排除，ESM/表达式/任意组件/事件/危险链接拒绝，正文链接与锚点、来源 pending、AST 属性、引用式图片绕过、symlink、重定向目标、配置/锁字段一致。

发布侧覆盖 R1→R2→R3 历史资格，排队旧任务跳过，上传中 master 前进，非后代拒绝，上传失败不移动指针，激活后 marker 失败及下一轮修复，显式历史回滚，未激活包拒绝，坏历史记录拒绝，同版本幂等，不可变对象损坏，预览/未知 schema/摘要错误，大小边界，回滚缺资源拒绝。

发布器测试使用可注入内存对象存储验证故障与顺序；它不证明远端 S3、GitHub 串行执行或全球网络行为。此前小规模验证另有真实 Miniflare/workerd R2 测试，不把两者混称线上验收。

## 实际修正

- 原始 Zod 通用 union 验证完整包约 12 秒；改为按节点 type 分派后约 0.16 秒。本机 Node 读数，不是 Worker 的性能保证。
- 标准化 code-line 文本节点的 type，让严格 reader 直接按类型校验。
- 缺失介绍译文只生成一个英文回退，避免与介绍页 canonical 重定向冲突。
- 保留 zod/v3 语义，避免前端 Zod 4 的 enum record 把缺译误判为必须补齐所有语言。
- 前端旧 playground 示例路径与 API 不一致，已记录在交接中；该页面目前禁用，不扩大本次源码改造范围。

直接在 Node 中加载 Tina 浏览器包会遇到 color-string CommonJS 命名导出问题，因此 schema/lock 校验采用隔离的 TypeScript 转译与 defineConfig stub，不加载浏览器编辑器依赖。Tina 官方 CLI 构建正常；此项不作为浏览器 UI 已验收的证据。

## 仍需线上验收

- R2 staging/prod 专用桶与 S3 凭证、GitHub OIDC 到 Infisical 的限定身份、首次 Actions 发布/回滚。
- Tina 管理后台托管、真实用户登录、保存到 Git；React 19 peer 告警的浏览器实际兼容性。
- frontend 既有 plan 的 19 项实施验收：完整 Next/OpenNext、原生 binding、软导航一致性、三语搜索/SEO/资源、历史资格与故障语义。

本轮没有修改 frontend 业务源码。其工作区后来出现 support-tickets 未提交变更，作为并行任务保留，本轮事实仍采用固定前端 SHA。

可复现代码位于 scripts/、contracts/、tests/；原始日志在本地 .cache/。完整交接副本位于 frontend `.ai/2026-10-09/docs-cms-runtime-poc/evidence/docs-writer/`，该证据目录按前端规则不自动进入 Git。
