# TinaCMS 初始化与环境配置

本仓负责独立编辑后台，前端仅消费发布后的内容包。当前初始化登记三语集合与内容元数据，不创建示例正文冒充已完成的业务文档，也不启用 R2 发布。

## 配置和凭证

Infisical 项目 `steammarket`，secret path `/cscheap/docs`，环境 `dev`、`staging`、`prod`。2026-10-09 已保存并逐项读回核验：

| 变量 | 用途 | 分类 |
| --- | --- | --- |
| `CSCHEAP_DOCS_TINA_CLIENT_ID` | TinaCloud 项目标识 | 非秘密配置 |
| `CSCHEAP_DOCS_TINA_READ_TOKEN` | 后台构建和 Content API 验证 | Secret |
| `CSCHEAP_DOCS_TINA_BRANCH` | 指定索引分支，默认 `master` | 可选配置，尚未写入 Infisical |

三个环境目前使用同一个 TinaCloud 项目和同一个用户提供的只读 Token；并不表示已经隔离为三个 CMS 项目，也不表示令牌有分支级权限。编辑用户通过 TinaCloud 登录，读 Token 不授予 Git 编辑权限。

只向运行命令的进程注入所需变量；本机也可用被忽略的 `.env`。管理员密码不作为 docs 配置保存。前端运行时无需这些变量。

`scripts/tina.mjs` 仅把非秘密 Client ID / branch 映射到 `TINA_PUBLIC_*`，让后台浏览器包可以读取；Token 保持构建期变量。配置使用 `client.skip`，不生成带 Token 的站点查询 SDK。不向 `TINA_PUBLIC_*` / `NEXT_PUBLIC_*` 映射 Token。

## 本地使用

Node 22，依赖以 `package-lock.json` 固定：

```bash
npm ci --no-audit --no-fund
npm run cms:check
npm run cms:dev
# dev 就绪后会生成 tina/tina-lock.json，检查完成可 Ctrl-C 退出。
# 可选：尝试本地后台打包；无需线上凭证，不是生成锁文件的命令。
npm run cms:build:local
```

本地构建命令显式使用 `--local --skip-cloud-checks`，不验证 TinaCloud 索引或编辑权限；Tina CLI 4.0.1 的 `--local` 本身仍执行云端检查。该组合仅用于无凭证的离线验证，本地构建输出不能作为云端后台部署。

云端变量注入后运行 `npm run cms:build`；正式构建保留 Tina 的云端检查，不通过 `--skip-cloud-checks` 绕过错误。管理后台生成到 `public/admin/`，后续选择独立托管目标时再确定域名和部署流程。

## 首次建立云端索引

1. 运行 `npm run cms:dev`，就绪后检查 `tina/tina-lock.json`。CLI 4.0.1 由 dev 生成此锁文件，单独 build 不会刷新它。配置的三语集合路径为 `content/en`、`content/zh-CN`、`content/ru`；维护说明不被加载为用户正文。
2. 将 `tina/config.ts`、`tina/tina-lock.json`、依赖清单和锁文件、启动脚本及忽略规则一起提交到 Tina 项目的目标分支。当前目标为 `cscheap/docs` 的 `master`；遵守本仓 commit/push 需用户明确要求的约定。
3. TinaCloud 自动索引后检查 dashboard 状态，再用只读 Token 查询集合。集合可以为空；空集合成功不等于业务正文初始化完成。
4. 单独验收认证编辑用户的保存→Git 提交；之后再验收 docs 发布→frontend 更新。索引成功本身不证明这两条链路完成。

2026-10-09 实际探测：提供的 Token 查询 master 返回 404 `Branch 'master' not found`，无效 Token 对照返回 401。GitHub 远端确有 master；用户提供的 Tina dashboard 警告明确说明尚无 Tina config。因此当前问题为仓库初始化缺失，不能据此要求更换 Token。配置仅在本地准备好后，警告仍会保留到文件推送并被索引。

同日用本仓配置在临时目录启动真实 Tina API，三个集合均通过创建、修改、重读及 MDX 落盘核验；英文、中文、俄文元数据均保留。已复制 CLI 生成的锁文件。本地后台打包在 1536 MiB Node 堆上限下发生 OOM，未生成可验收后台；后续须在有足够资源的构建环境重试。该失败不应混同为 schema/API 验证失败，也不代表后台已可部署。安装另有 Tina 内部 react-final-form 的 React 19 peer 警告，管理 UI 兼容性仍须验收。

## 与 R2 的关系

Tina 索引不需要 R2。R2 属于本项目选择的发布层，保存已经校验的版本化正文包、导航/搜索数据和图片。docs 发布器负责上传和激活；frontend 通过绑定读取，因而正文更新无需 frontend 构建。

上线时发布器只需专用文档桶的 S3 `Object Read & Write`，不需账户管理员权限；frontend 不接收上传密钥。R2 的桶、凭证、CI 和正式发布本轮尚未配置。

参考：[TinaCloud 初始化](https://tina.io/docs/tinacloud/overview)、[Tina 配置与环境变量](https://tina.io/docs/reference/config)、[CLI](https://tina.io/docs/cli-overview)、[R2 权限](https://developers.cloudflare.com/r2/api/tokens/)。
