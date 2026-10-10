# 移除 TinaCMS，使用 Fumadocs 编译与 R2 发布

状态：2026-10-10 用户确认，取代 ADR 0002 / 0003 中的 TinaCMS 编辑器与正文格式；保留 Git 权威来源和不可变 R2 发布机制。

TinaCMS 不承担线上读取职责，其管理后台、登录和 Git 写回也尚未完成验收。用户选择由 AI 直接维护 MDX，减少编辑器依赖及凭证配置。

正文契约升级为 schemaVersion 2 / rendererContract 2：Fumadocs 16.7.9 的 remarkHeading、remarkStructure 生成标题与搜索结构；Shiki 4.2.0 生成 github-light / github-dark 代码 token。正文使用严格受限的 hast 形状节点和每个代码块的紧凑调色板；不传送或执行 JavaScript、HTML 字符串。

Git MDX、147 页正文与四项目 SHA 基线保留。发布继续上传摘要寻址的完整内容包和资源，经读回验证后替换一个 current 指针。指针、历史发布记录仍为 schemaVersion 1；正文包升级不改变它们。

frontend 只接入 v2。v1 从未在线激活，无需兼容旧正文格式。新增组件或不兼容契约必须先部署 frontend；普通正文、翻译和导航变化无需应用构建。

以下为本决策当时的发布配置，现已由 [ADR 0005](0005-branch-based-r2-publication.md) 的双分支和仓库 Secrets 配置取代。工具链与内容契约决策继续有效。

staging / production 共用 master 来源并使用不同桶；用户暂授权共用一组 R2 对象凭证。沿用 frontend 构建期最小配置模式，将四个发布键从 Infisical 复制到 GitHub 对应 Environment。既有来源 IP 白名单使云端构建机不能直接访问 Infisical，因此不引入运行时 OIDC 拉取。账号和桶使用 Variables，S3 凭证使用 Secrets，轮换时同步更新。

参考：[Fumadocs 固定版本实现](https://github.com/fuma-nama/fumadocs/tree/fumadocs-core%4016.7.9/packages/core/src/mdx-plugins)、[Shiki 双主题](https://shiki.style/guide/dual-themes)、[R2 身份验证](https://developers.cloudflare.com/r2/api/tokens/)。
