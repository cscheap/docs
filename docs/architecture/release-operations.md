# 构建、发布与回滚

## 本地验证与版本关联

```bash
npm ci
npm run check
```

`check` 运行 TypeScript 检查、API 生成一致性、正文编译与合同测试。输出 dist/bundle.json、dist/build.json 和仅被有效页面使用的资源。默认预览用全零 docsCommit，明确不可发布；不拿旧提交 SHA 冒充尚未提交的正文版本。

提交后的干净 checkout 使用 `npm run docs:build`，记录 HEAD 完整 SHA；Actions 中还必须与事件 GITHUB_SHA 一致。node_modules、dist、.cache 和凭证文件不入 Git。

## 更新业务版本

1. 单独更新涉及项目的 baselines 文件，核对 GitHub 完整 SHA。改为 pending。
2. 读取该提交，复核所有 sources 引用了它的页面，更新英文和真实译文。
3. 记录事实证据，再把 documentationReview 改为 reviewed。不能仅刷新 SHA。
4. 更新 navigation.json 和必要的 redirects.json；每个可发布页必须在导航中。
5. 运行 check。过期译文被排除、记录警告，并生成英文回退；其他无效输入使构建失败。

## 更新 API 参考

```bash
/path/to/cscheap-api/.venv/bin/python scripts/export-api.py /path/to/cscheap-api
npm run api:generate
npm run check
```

Python 使用该 API 的已安装依赖，但代码来自 baselines/api.json 的 git archive；不运行 lifespan，禁止 socket 连接。生成器只保留公开/普通用户操作，清除示例、内部扩展并剪裁 schema 引用。13 个操作集合变化时停止，先复核范围。

openapi/ 保存审核后的三语投影和来源摘要；content/*/api/reference/ 与 assets/openapi-*.json 都由生成器生成。不要手工编辑这些生成页。CI 从本仓审核后的投影验证生成一致性，不需要访问业务私有仓或数据库。

## GitHub Actions 与分支

| 来源 | 动作 | 固定目标 |
| --- | --- | --- |
| PR | check 与本地预览 artifact，不读取发布凭证 | 无 |
| push 到 preview | check 通过后从事件 SHA 构建、上传并激活 | preview-cscheap-docs |
| push 到 master | check 通过后从事件 SHA 构建、上传并激活 | cscheap-docs |
| 手动 publish / rollback | 使用 Run workflow 的分支选择器，只接受 preview / master | 对应分支的固定桶 |

没有额外发布开关、环境选择输入或 GitHub Environment。首次向两个分支推送本工作流即会尝试自动发布，三项仓库 Secrets 必须已就绪。

每个分支的激活与回滚共用 `cscheap-docs-activation-<branch>`，cancel-in-progress=false。两个桶可独立推进。串行不等于 FIFO；激活前重新 fetch 对应分支，核对最新 SHA 与当前发布的祖先关系，过时任务跳过。

日常将独立 docs PR 合入 preview，完成预览验收后将 preview 合入 master。两分支不自动互相同步；生产热修复后将 master 合回 preview。保持历史连续，避免重建或强推长期发布分支。合并提交的 SHA 可以不同，因此生产发布会有自己的 docsCommit / releaseId，即使正文与预览一致。

没有跨仓聚合 PR、frontend dispatch、frontend 构建或 revalidation 请求。内容、基线、译文与导航在同一提交中组成一个发布快照。

## 三项仓库 Secrets

在 **cscheap/docs → Settings → Secrets and variables → Actions → Repository secrets** 配置：

| 名称 | 值的来源 |
| --- | --- |
| CSCHEAP_DOCS_R2_ACCOUNT_ID | Cloudflare Account ID，32 位十六进制账号标识 |
| CSCHEAP_DOCS_R2_ACCESS_KEY_ID | R2 S3 Access Key ID |
| CSCHEAP_DOCS_R2_SECRET_ACCESS_KEY | 与上述 Access Key 配对的 S3 Secret Access Key |

Account ID 不是 Cloudflare API token。发布器使用 S3 API，不需要 `cfut_...` API token。桶名在 `scripts/deployment.mjs` 写死，`CSCHEAP_DOCS_R2_BUCKET`、`CSCHEAP_DOCS_ENVIRONMENT` 与 `CSCHEAP_DOCS_PUBLISH_ENABLED` 均不再使用。

无需建立 GitHub Environments 或 Actions Variables。若之前创建了这些配置，本工作流不读取它们；仓库 Secrets 中的三项名称必须与上表完全一致。

R2 凭证需对两个文档桶有 Object Read & Write 权限，用户暂授权共用一组对象凭证。发布器不创建桶、不管理 DNS/Workers。frontend 只需 `CSCHEAP_DOCS_BUCKET` 原生 binding，preview 绑定预览桶，生产绑定生产桶，不接收 S3 secret。

## Infisical 的角色

沿用 frontend 既有构建期配置模式。Infisical steammarket 项目 staging / prod 环境 `/cscheap/docs` 保留凭证记录；CI 只使用用户配置的仓库 Secrets。既有 Infisical 来源 IP 白名单阻止云端 runner 直接访问，因此发布任务不连接 Infisical，也不新增 OIDC 或网络代理。

既存 `CSCHEAP_DOCS_R2_BUCKET` 值仅作环境记录，实际发布映射以代码为准。轮换凭证时同步更新三项仓库 Secrets，并在 preview 手动 publish 验证；手动副本不会自动同步。本次分支改造不改 Infisical 或 frontend 既有 Cloudflare Workers Secret Sync。

## 首次启用与前端验收

1. 确认三项仓库 Secrets 已配置，两个固定桶已存在。
2. 推送 preview，等待 Documentation 的 validate / activate 成功；核对 bundle、资源、current/previous 和 published 记录。
3. 将已验证变更合入 master，同样验证生产桶发布。内容包就绪不等于 frontend 已接入。
4. 前端 AI 完成既有 plan 的 v2 reader、路由、搜索、SEO、R2 binding 与 E2E，在预览环境验证实际软导航和 R1→R2→R3。
5. 前端生产接入后做一次仅正文修改，确认无需 frontend 构建即可读取新 release。

## 发布失败与回滚

资源或 bundle 上传/校验失败：current 不变。激活前对应分支已前进：旧任务返回 skipped-stale。重复激活同一 release：already-current，不改 previous。

指针成功但 published 标记失败：工作流失败时当前版本可能已切换。先检查指针，不把失败一律理解为“没有发布”；下一次激活会先修复 current/previous 的标记。上传但未激活的包没有历史读取资格。

回滚在 Actions → Documentation → Run workflow：选择 preview 或 master，mode=rollback，release 填该桶已激活过的完整 64 位 releaseId。回滚只调整所选桶的整个内容包，原 current 变成 previous，不改 Git 分支。之后该分支的新提交仍会自动发布；永久撤销内容应通过 Git revert。首版不自动删除历史对象；整个桶不可用时，同桶 previous 不是灾备。
