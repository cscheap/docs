# 构建、发布与回滚

## 本地验证与版本关联

```bash
npm ci
npm run check
```

`check` = `typecheck` + `api:check`（生成器零差异）+ `docs:check`（两频道编译到 `dist/`）+ `test`。本地构建用全零 docsCommit，`dist/build.json` 标 `local: true`，发布器拒绝；不拿旧提交 SHA 冒充尚未提交的正文。

提交后的干净 checkout 使用 `npm run docs:build`：记录 HEAD 完整 SHA，Actions 中还必须与事件 `GITHUB_SHA` 一致。`dist/` 先清空再写：`preview/manifest.json`、`production/manifest.json`、`objects/<sha256>.json`、`assets/<sha256>/<file>`、`build.json`（两频道 releaseId、页数、字节数、警告）。node_modules、dist、.cache、`.ai/` 和凭证文件不入 Git。

## 更新业务版本

1. 单独更新涉及项目的 baselines 文件，核对 GitHub 完整 SHA。改为 pending。
2. 读取该提交，复核所有 `sources` 引用了它的单元，更新英文和真实译文。
3. 记录事实证据，再把 documentationReview 改为 reviewed；任一基线 pending 时编译失败。
4. 更新 navigation.json 和必要的 redirects.json；每个单元必须在导航中。
5. 运行 check。过期译文被排除并记录警告；其他无效输入使构建失败。

## 更新 API 参考

```bash
/path/to/cscheap-api/.venv/bin/python scripts/export-api.py /path/to/cscheap-api
npm run api:generate
npm run check
```

Python 使用该 API 的已安装依赖，但代码来自 baselines/api.json 的 git archive；不运行 lifespan，禁止 socket 连接。生成器只保留公开/普通用户操作，清除示例、内部扩展并剪裁 schema 引用；操作集合变化时停止，先复核范围。

`openapi/` 保存审核后的三语投影和来源摘要；`content/api/reference/**` 单元与 `assets/openapi-*.json` 都由生成器生成。生成器只改它拥有的字段与文件，保留每个单元已有的 `stage` / `deprecated` / `workflow`；新单元初始 `draft`，需要代理按流程推进到 `published`。CI 用 `api:check` 验证生成一致性，不访问业务私有仓。

## GitHub Actions

单分支 `master`，工作流 `.github/workflows/docs.yml`：

| 事件 | job | 动作 | 凭证 |
| --- | --- | --- | --- |
| `pull_request` | `validate` | `npm run check`，上传 `dist/` 为 artifact | 无 |
| `push master` | `validate` → `activate` | check → `docs:build` → `node scripts/publish.mjs`（两频道） | 两项 Secrets |
| `workflow_dispatch`（`mode=rollback`，`channel`，`release`） | `rollback` | typecheck → 只跑 publisher / kv-store 测试 → `publish.mjs` rollback 模式；**不依赖 `validate`、不 `docs:build`** | 两项 Secrets |

`activate` 与 `rollback` 共用并发组 `cscheap-docs-activation`，cancel-in-progress=false；并发组不是 FIFO，激活前重新 fetch `origin/master` 并核对祖先关系，过时任务 `skipped-stale`。`publish.mjs` 入口守卫：`GITHUB_ACTIONS=true`、`GITHUB_REPOSITORY=cscheap/docs`、`GITHUB_REF=refs/heads/master`、工作区干净、HEAD = `GITHUB_SHA`；本地永不发布。

每次推送 `master` 自动尝试发布，没有发布开关、环境选择或 GitHub Environment。

## 两项仓库 Secrets

在 **cscheap/docs → Settings → Secrets and variables → Actions → Repository secrets** 配置：

| 名称 | 值 |
| --- | --- |
| `CSCHEAP_DOCS_CF_ACCOUNT_ID` | Cloudflare Account ID，32 位十六进制 |
| `CSCHEAP_DOCS_CF_API_TOKEN` | Cloudflare API token：Workers KV Storage Write + 桶 `cscheap-content` 的 R2 对象读写 |

KV 与 R2 都走 Cloudflare REST API，同一个 token；没有 S3 凭证，也没有 SDK 依赖。命名空间 id 与桶名固定在 `scripts/deployment.mjs`，不能经输入或变量改写。Infisical `steammarket` 项目 `/cscheap/docs` 路径保留凭证记录；CI 不连接 Infisical（来源 IP 白名单），轮换后手动同步仓库 Secrets。frontend 用原生 KV / R2 binding 读取，不接收 token。

## 本地真机验收

两个脚本在真实命名空间 / 桶上运行，只写 `test/<run-id>/` 前缀（正则强制 `test/[a-z0-9][a-z0-9-]{0,39}/`），结束时删除并轮询确认已不可读（KV 删除最终一致）。本地 `.env` 提供同名两项凭证。

```bash
npm run test:kv -- --prefix test/<run-id>/
DOCS_ALLOW_LOCAL_PUBLISH=1 npm run test:publish-local -- --prefix test/<run-id>/
```

- `test:kv`（`scripts/kv-store.integration.mjs`）：写 1,500 键（含一个 300 KiB 值）→ list 跨分页 → get 逐键比对 → delete → 确认为空。
- `test:publish-local`（`scripts/publish-local-test.mjs`）：用 `tests/fixtures/minimal` 构建版本 A 并激活 → 改一页构建版本 B 并激活（`previous = A`）→ 回滚到 A → 重跑 A 得 `already-current` → 清理。拒绝条件：缺 `DOCS_ALLOW_LOCAL_PUBLISH=1`、无前缀或非 `test/` 前缀、缺凭证；拒绝发生在创建任何存储客户端之前。不读 `GITHUB_*`，`docsCommit` 用本地 HEAD（允许工作区脏）。

它不是日常发布能力；正式发布只走 Actions。

## 发布失败与回滚

频道结果：`published`、`already-current`（重复激活同一版本，不改 `previous`）、`skipped-stale`（激活前 `master` 已前进）、`rolled-back`、`failed-before-switch`（上传 / 校验 / 标记任一失败，指针不变）、`unknown`（指针写后确认 3 次读不到新值；标记已在，先查指针再决定是否重跑）。两频道各自结果写在作业日志末行的 JSON 里；任一 `failed-before-switch` / `unknown` 则作业失败，但已成功的频道保持切换。

回滚：Actions → Documentation → Run workflow，`mode=rollback`，选 `channel`，`release` 填该频道已激活过（指针 current/previous 或带本频道标记）的完整 64 位 releaseId。回滚只验证不补传，引用对象或资源缺失即拒绝且指针不变；不允许跨频道回滚。永久撤销内容通过 Git 修改单元 stage 或正文。

## 迁移记录

v2 → v3 迁移一次性完成：源提交 `f11a521a0dcd32636ad04495414f207f38657451`，93 单元 × 3 语种 = 279 页逐字节核对，全部 `stage: published`，有效译文摘要全部重算为新 `en.mdx` 摘要。迁移脚本不入库（在 `.ai/2026-11-04/docs-repo-rebuild-v3/assets/`）。前端读取端切换并上线后，退役 `preview` 分支与 v2 的两个旧 R2 桶（名称见 [ADR 0006](../decisions/0006-content-contract-v3.md) 后续事项）；切换前线上文档停在最后一版 v2 内容，没有热修复通道。
