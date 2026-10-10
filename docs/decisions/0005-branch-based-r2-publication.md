# 双分支发布与仓库 Secrets

状态：2026-10-10 用户确认。取代 ADR 0004 中单 master、GitHub Environments 及四项配置的发布安排；内容契约和工具链保持不变。

保留 preview 与 master 两个长期分支。preview 自动发布到 preview-cscheap-docs，master 自动发布到 cscheap-docs。桶名在代码中固定，手动发布和回滚也由所选分支决定目标，不允许另选环境。先在 preview 验收，再合入 master；不会自动合并两个分支。

CI 仅读取三项 Repository Secrets：CSCHEAP_DOCS_R2_ACCOUNT_ID、CSCHEAP_DOCS_R2_ACCESS_KEY_ID、CSCHEAP_DOCS_R2_SECRET_ACCESS_KEY。用户暂共用两桶的 S3 凭证。不需要 Environment、Variables 或发布开关。Infisical 保留现有记录，轮换后手动同步仓库 Secrets，CI 不连接 Infisical。

每个分支独立串行化激活与回滚，避免一个环境的新任务替换另一个环境的等待任务。发布前重新 fetch 对应分支，并验证当前已发布 SHA 的祖先关系；过时构建不能覆盖新内容。回滚只接受所选桶里已激活过的 release。

这是应用层发布约束；共用凭证本身拥有两个桶的权限。若以后需要凭证级隔离，再拆分两组凭证。frontend 仍通过各环境的 R2 binding 读取，无需参与正文发布构建。

参考：[GitHub Actions 并发控制](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)、[R2 S3 凭证](https://developers.cloudflare.com/r2/api/s3/tokens/)。
