# 构建、发布与回滚

## 本地验证与版本关联

```bash
npm ci
npm run check
```

`check` 运行 TypeScript 检查、API 生成一致性、正文编译与合同测试。输出 dist/bundle.json、dist/build.json 和仅被有效页面使用的资源。默认预览用全零 docsCommit，明确不可发布；不拿旧提交 SHA 冒充尚未提交的正文版本。

提交后的干净 checkout 使用 `npm run docs:build`，记录 HEAD 完整 SHA；Actions 中还必须与事件 GITHUB_SHA 一致。node_modules、dist、public/admin、.cache 和凭证文件不入 Git。

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

openapi/ 保存审核后的三语投影和来源摘要；content/*/api/reference/ 与 assets/openapi-*.json 都由生成器生成。不要通过 Tina 修改这些生成页。CI 从本仓审核后的投影验证生成一致性，不需要访问业务私有仓或数据库。

## GitHub Actions

- PR：只读代码权限，安装锁定依赖，运行 check，上传本地预览 artifact；不取得生产 secret，也不请求 OIDC。
- master：完成同样校验；仓库变量 `CSCHEAP_DOCS_PUBLISH_ENABLED=true` 后，进入生产环境激活任务，从事件 SHA 编译正式产物。
- 手动发布：在 master 上选择 publish 与 staging 或 production。staging 对应 Infisical staging，production 对应 prod。
- 回滚：同一 workflow 选择 rollback、目标环境及完整 releaseId。仅接受已激活的历史版本。
- 所有环境的激活/回滚共用 `cscheap-docs-activation`，cancel-in-progress=false。串行不等于 FIFO，代码在激活前重新 fetch master 并核验祖先关系；旧任务跳过。

正常提交、合并只发生在 docs 仓；没有跨仓聚合 PR、frontend dispatch、frontend 构建或 revalidation 请求。提交同一行为涉及的内容、基线、译文和导航时，它们组成一个发布快照；独立变化仍使用独立 PR。

## 凭证与环境

R2 使用不同的 staging/prod 专用桶。以下键放在 Infisical steammarket 项目对应环境 `/cscheap/docs`：

| 键 | 内容 |
| --- | --- |
| CSCHEAP_DOCS_R2_ACCOUNT_ID | Cloudflare 账号 ID |
| CSCHEAP_DOCS_R2_BUCKET | 本环境文档桶名 |
| CSCHEAP_DOCS_R2_ACCESS_KEY_ID | 仅授权该桶的 S3 Access Key ID |
| CSCHEAP_DOCS_R2_SECRET_ACCESS_KEY | 对应 Secret Access Key |
| CSCHEAP_DOCS_TINA_CLIENT_ID | 已存储并核验的 Tina 项目 ID |
| CSCHEAP_DOCS_TINA_READ_TOKEN | 已存储并核验的 Tina 只读 token |

R2 权限使用该桶 Object Read & Write；发布器不创建桶，不读取其他桶，不管理 DNS/Workers。frontend 仅增加 `CSCHEAP_DOCS_BUCKET` 原生 binding，不接收 S3 secret。当前未取得合用的 R2 凭证，也未创建文档桶。

## GitHub → Infisical 身份

CI 使用 GitHub OIDC 换取短期 Infisical token，不把管理员账号密码放进 Actions。scripts/with-secrets.mjs 只读取上述指定键，拒绝重定向、限制请求时间和响应大小，secret 只在内存与子进程环境中存在。

待配置两类 Machine Identity：发布身份只读该环境四个 R2 键；CMS 身份只读 Tina 两键。若服务版本只支持路径级策略，至少限制到对应 environment 的 `/cscheap/docs`，不授予整个 steammarket 项目读权限。建议 access token TTL/max TTL 为 900 秒，组织角色使用允许的最小权限。

- issuer/discovery：`https://token.actions.githubusercontent.com`。
- audience：`https://github.com/cscheap`，与脚本一致。
- claims 限定实际 repository_id/repository_owner_id、`ref=refs/heads/master`、对应 environment 及 workflow_ref。docs 发布与 CMS 构建分别绑定各自 workflow。
- **不能猜 subject**：2026-07-15 后的新仓可能采用带数字 ID 的不可变 subject；先读取仓库 OIDC customization 的 sub_claim_prefix，再加 `:environment:production` 或 `:environment:staging`。不要复制旧的仅名字模板或使用宽泛通配符。
- GitHub environment variables：发布的 `CSCHEAP_DOCS_INFISICAL_IDENTITY_ID`；CMS 的 `CSCHEAP_DOCS_CMS_INFISICAL_IDENTITY_ID`。环境 deployment branches 限 master。

身份与实际 claims 尚未在线配置/验收。以 [Infisical GitHub OIDC 文档](https://infisical.com/docs/documentation/platform/identities/oidc-auth/github)为核对依据。当前机器没有已认证的 gh CLI；现有 Git SSH 推送能力不等于 Actions 配置管理权限。

## 首次启用

1. 确认 master 上待发布提交的 Documentation 校验通过，且 TinaCloud 已索引三语正文。
2. 配置桶、Infisical secrets、限定身份和 GitHub variables。CI 的发布开关缺省关闭；这是首次部署准备状态，正常使用时置 true 后 master 自动发布。
3. 在 staging 执行 publish，核对读回摘要、完整资源、current/previous 与 published 记录。
4. 前端 AI 完成既有 plan 的 reader/路由/搜索/SEO/E2E，在 staging 通过实际软导航与 R1→R2→R3 验证。
5. 完成生产 binding 后发布 production。做一次仅正文修改，确认 frontend 不出现构建任务，下一次文档请求读取新 release。

## 发布失败与回滚

资源或 bundle 上传/校验失败：current 不变。激活前 master 已前进：旧任务返回 skipped-stale。重复激活同一 release：already-current，不改 previous。

指针成功但 published 标记失败：工作流失败时当前版本可能已切换。先检查指针，不把失败一律理解为“没有发布”；下一次激活会先修复 current/previous 的标记。上传但未激活的包没有历史读取资格。

回滚使用历史 releaseId，由同一受控 workflow 激活整个内容包，原 current 变成 previous。首版不自动删除历史对象。若整个桶不可用，同桶 previous 不是灾备。

## Tina 编辑器

`cms.yml` 在显式启用 `CSCHEAP_DOCS_CMS_BUILD_ENABLED=true` 后，对 schema/依赖变化或手动请求生成独立编辑器 artifact；上传前扫描是否意外包含 secret。它没有发布独立对外文档网站，也没有自动托管管理后台。

编辑器托管域名、登录、GitHub App 写回验收尚待接入。当前 AI 直接编辑 MDX 的维护方式继续有效。一次 schema 变化可能需要更新 tina-lock.json 并重新构建后台；正文修改不要求重建后台或 frontend。
