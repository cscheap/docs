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

## GitHub Actions

- PR：只读代码权限，安装锁定依赖，运行 check，上传本地预览 artifact；不取得生产 secret，也不请求 OIDC。
- master：完成同样校验；仓库变量 `CSCHEAP_DOCS_PUBLISH_ENABLED=true` 后，进入生产环境激活任务，从事件 SHA 编译正式产物。
- 手动发布：在 master 上选择 publish 与 staging 或 production；不受自动发布开关限制，因此开关为 false 时可以先验证 staging。staging 对应 Infisical staging，production 对应 prod。
- 回滚：同一 workflow 选择 rollback、目标环境及完整 releaseId。仅接受已激活的历史版本。
- 所有环境的激活/回滚共用 `cscheap-docs-activation`，cancel-in-progress=false。串行不等于 FIFO，代码在激活前重新 fetch master 并核验祖先关系；旧任务跳过。

正常提交、合并只发生在 docs 仓；没有跨仓聚合 PR、frontend dispatch、frontend 构建或 revalidation 请求。提交同一行为涉及的内容、基线、译文和导航时，它们组成一个发布快照；独立变化仍使用独立 PR。

## 凭证与环境

R2 使用不同的 staging/prod 专用桶。staging 为 `preview-cscheap-docs`，prod 为 `cscheap-docs`。用户暂授权两环境共用一组对象读写凭证；publisher 还检查环境与桶名配对。以下键放在 Infisical steammarket 项目对应环境 `/cscheap/docs`：

| 键 | 内容 |
| --- | --- |
| CSCHEAP_DOCS_R2_ACCOUNT_ID | Cloudflare 账号 ID |
| CSCHEAP_DOCS_R2_BUCKET | 本环境文档桶名 |
| CSCHEAP_DOCS_R2_ACCESS_KEY_ID | S3 Access Key ID，暂共用两文档桶凭证 |
| CSCHEAP_DOCS_R2_SECRET_ACCESS_KEY | 对应 Secret Access Key |

R2 需要文档桶 Object Read & Write；发布器不创建桶，不读取其他桶，不管理 DNS/Workers。frontend 仅增加 `CSCHEAP_DOCS_BUCKET` 原生 binding，不接收 S3 secret。2026-10-10 两个桶均已存在，用户凭证在两边的临时对象写入、读回与删除验证通过。三个环境的旧编辑变量已清理，dev 不放线上发布写凭证。

## GitHub 构建变量与 Infisical

沿用 frontend 已验证的构建期接入方式：Infisical 是权威来源，向 CI 手动配置最小变量集。既有部署记录指出 Infisical 服务器有来源 IP 白名单，云端构建机不能直接访问；不在发布任务中调用 Infisical，不新增 OIDC 或网络代理。

两环境在 Settings → Environments 建立，并只允许 master 部署。分别填写：

| GitHub 位置 | 名称 | staging | production |
| --- | --- | --- | --- |
| Environment Variable | CSCHEAP_DOCS_R2_ACCOUNT_ID | 对应 Infisical staging 值 | 对应 Infisical prod 值 |
| Environment Variable | CSCHEAP_DOCS_R2_BUCKET | preview-cscheap-docs | cscheap-docs |
| Environment Secret | CSCHEAP_DOCS_R2_ACCESS_KEY_ID | 对应 S3 Access Key ID | 暂与 staging 共用 |
| Environment Secret | CSCHEAP_DOCS_R2_SECRET_ACCESS_KEY | 对应 S3 Secret Access Key | 暂与 staging 共用 |

仓库 Settings → Secrets and variables → Actions → Variables 另建 `CSCHEAP_DOCS_PUBLISH_ENABLED=false`。手动 staging 验收完成后改为 `true`，开启 master 自动生产发布。手动任务始终要求明确的环境及 master 来源，不受自动开关限制。

GitHub 不配置 Infisical 管理员密码、身份 ID、Client Secret 或 R2 API token 原值；发布器只用 S3 访问凭证。Infisical 中值变更/轮换后，必须同步更新对应 GitHub Environment。记录更新日期并手动发布验证，不能假定手动副本自动同步。

frontend 的既有 Cloudflare Workers Secret Sync 保持原状，docs 不复用它的目标；frontend 文档 reader 只需 R2 binding，不接收上传密钥。

本机 Git SSH 推送能力不等于 GitHub 配置管理权限，上述 GitHub 设置由用户完成。今后若需要自动同步 GitHub Secrets，可单独配置 Infisical GitHub Secret Sync；本轮不引入新的账户授权。

## 首次启用

1. 确认 master 上待发布提交的 Documentation 校验通过，内容包为 v2 且 docsCommit 是该提交。
2. 配置桶、Infisical secrets 和 GitHub Environment variables/secrets。CI 的发布开关缺省关闭；这是首次部署准备状态，正常使用时置 true 后 master 自动发布。
3. 在 staging 执行 publish，核对读回摘要、完整资源、current/previous 与 published 记录。
4. 前端 AI 完成既有 plan 的 reader/路由/搜索/SEO/E2E，在 staging 通过实际软导航与 R1→R2→R3 验证。
5. 完成生产 binding 后发布 production。做一次仅正文修改，确认 frontend 不出现构建任务，下一次文档请求读取新 release。

## 发布失败与回滚

资源或 bundle 上传/校验失败：current 不变。激活前 master 已前进：旧任务返回 skipped-stale。重复激活同一 release：already-current，不改 previous。

指针成功但 published 标记失败：工作流失败时当前版本可能已切换。先检查指针，不把失败一律理解为“没有发布”；下一次激活会先修复 current/previous 的标记。上传但未激活的包没有历史读取资格。

回滚使用历史 releaseId，由同一受控 workflow 激活整个内容包，原 current 变成 previous。首版不自动删除历史对象。若整个桶不可用，同桶 previous 不是灾备。
