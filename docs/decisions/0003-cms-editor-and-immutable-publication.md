# CMS 编辑与不可变文档发布

TinaCMS 相关部分已由 [0004](0004-drop-tina-fumadocs-toolchain.md) 取代，以下正文保留历史决策。

日期：2026-10-09。状态：本地 PoC 后选定的实施设计；尚未部署。细化并替代 0002 中的直接 CMS API / 双仓候选。

## 决定

使用 TinaCMS 编辑 Git，docs CI 从固定 Git SHA 编译 MDX AST，上传 R2 不可变内容包并最后切换发布指针。frontend 运行时读取包并保留 Fumadocs 页面。文字、新页、图片、导航和搜索更新只构建文档数据，不构建 frontend。

CMS schema、编辑器和发布工具放在 docs，TinaCloud 默认只绑定 docs 一个仓库。管理后台独立托管，仅配置/后台代码变化时部署；它不是独立对外文档站。frontend 不需要 CMS 编辑器入口、登录或 GitHub 写权限。

## 验证所得

- CLI 4.0.1 / tinacms 3.14.3 / parser 2.3.0：三语、Callout、表格、代码块、API 往返、API 增删改得到实际验证。
- Tina 保留 GraphQL `id`，正文稳定标识改为 `docId`。
- 原生 parser 可离线读取字节并得到与 API 相同的 AST，无需等待 CMS 索引。
- React 19 + Fumadocs Callout + StaticTinaMarkdown 在与 frontend 相同日期的 workerd 中渲染通过。本地 R2 单指针切换、新页、固定版本搜索和回滚通过。
- 本地 CLI 文件 watcher 在测试中未及时反映直接文件修改；这不证明 TinaCloud 有相同问题，但不能把移动索引当成原子发布机制。

原始代码/输出保存在 frontend `.ai/2026-10-09/docs-cms-runtime-poc/evidence/`，基线 frontend SHA 为 `01547868bdd0d87d13815e9d60938c27a8beaa50`。计划尚未提交；原始 evidence 按前端仓规则仅保留本地，跨机器交接需单独复制。

## 影响

增加文档 R2 桶（staging/production 分离）及 docs 内容编译流程；不引入业务数据库、队列或全站 ISR。正文、目录、TOC、搜索、有效语言与四项目基线来自同一个包。

发布端串行激活并拒绝旧 SHA 覆盖新版本；内容回滚切指针。单对象激活不等于多对象事务，完整产物上传/验证是切换前提。前端读取失败只能退完整 previous，不混合新旧页面，也不能恢复合法删除的页面。

TinaCloud 编辑登录/Git 写回/套餐、GitHub Actions 并发、完整 Next/OpenNext UI 和线上 R2 尚未验证。用户已授权本地验证和前端计划，未进行任何账户开通、付款或生产部署。
