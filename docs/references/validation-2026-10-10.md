# 2026-10-10 v2 重构验证

本报告记录提交前实现与验证。正式文档版本以对应 Git 提交为准，生成内容包必须来自干净 checkout；本报告不代表已在 R2 激活或完成 frontend 接入。

- 移除编辑器依赖、配置、后台、工作流及旧秘密拉取脚本。锁文件依赖从 1,103 个降为 200 个，`npm ci` 成功，无忽略 peer 冲突参数。
- `npm run check` 通过：类型检查、13 个 API 操作三语生成一致性、正文编译、47 项测试，0 失败、0 跳过。
- 147 页（三语各 49）连续两次编译字节一致，warnings 为 0。正文、资源、OpenAPI 导出和四项目基线未改动。
- 内容包 1,456,290 字节，保留 8 MiB 上限；每页低于 256 KiB。171 个代码块（162 JSON、9 Bash）与源码文本无损对应，直接 Shiki 对照通过。
- 全语料逐页独立执行 Fumadocs 标题/搜索插件；TOC、正文 id、structuredData 一致。测试覆盖重复标题、代码标题、中俄标题、Callout 内标题及重复自定义 id 拒绝。
- 源码及契约拒绝可执行 MDX、未知组件、属性注入、危险链接、外部图片、引用图片绕过、任务列表、脚注和数学语法；超深树、超大页面、错误调色板索引拒绝。
- 同语言/跨语言/英文回退链接、资源、草稿、过期译文、悬空重定向和锚点校验通过。
- R1→R2→R3、旧任务跳过、指针保护、历史激活记录修复、回滚及未激活/预览/v1/未知版本拒绝保持通过。
- `preview-cscheap-docs`、`cscheap-docs` 已存在且初始为空。用户 S3 凭证在两桶的独立临时探针写入、读回和删除全部成功；未写 current 指针。
- Infisical dev/staging/prod 的旧编辑器键已移除；staging/prod 各写入四项 R2 配置并读回核验。dev 不放线上发布凭证。

用户要求参考此前 Cloudflare 发布方式后，核对 frontend ADR 0027 和部署 runbook，确认历史来源 IP 白名单约束。因此改用从 Infisical 复制至 GitHub Environments 的最小构建配置，撤回临时新增的 OIDC 身份，不改现有 infra 身份和 Worker Secret Sync。

完整命令输出、R2/Infisical 操作回执、GitHub 配置清单与最终前端交接 manifest 位于本地 `.ai/2026-10-10/contract-v2-fumadocs-toolchain/evidence/`。正式 GitHub Actions 发布、R2 激活/回滚及 frontend 联调仍需使用实际环境完成。
