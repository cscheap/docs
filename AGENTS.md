# 项目约定

本仓库是 cs.cheap 对外文档的权威内容仓库。先读 README 与 docs/architecture/README.md。

- 在项目文档合并到 docs 的流程建立前，由本仓的 AI 代理读取四个项目、编写全部正文并交叉复核，不委派给其他项目 AI；采集、审核、翻译代理各用自己的定时任务直接写入本仓，不经 GitHub Actions 触发。
- 正文以内容单元存放在 content/<section>/<page>/（item.json + en.mdx + zh-CN.mdx + ru.mdx）；业务仓是领域事实来源，不是正文来源。item.json 的 sources 记录页面依赖的逻辑项目。
- 英文为基准，zh-CN 和 ru 为译文，译文以整份 en.mdx 的 sourceDigest 标记来源；面向用户的交流使用简体中文。
- 基线记录在 baselines/，必须使用已验证存在于 GitHub 的完整 SHA。读取工作区时区分未提交改动；代码基线不等于生产部署证明。
- 单分支 master。item.json.stage 决定频道：reviewed 进 preview，published 进 preview 与 production；draft / held / retired 不进任何频道。没有人工审批闸，每次推送 master 自动校验、编译并激活两个频道。
- 流程状态只能经 workflow 日志推进：追加一条 { stage, by, at, note? }，顶层 stage 改为同值；不改写或删除既有条目。
- Git 是正文权威来源。KV / R2 只保存可重建的发布产物（内容寻址对象、频道 manifest、指针、标记）；不能另建一份手工维护的数据库正文。
- MDX 使用已登记的组件模板和属性（只有 Callout）。新组件代码需要 frontend 部署，不承诺任意 MDX JavaScript 都可以免部署运行。
- 文档目录、导航、正文、搜索和版本记录必须指向同一频道 manifest。navigation.json 列出每个单元；published 页不得链接到 production 之外的单元，否则生产频道构建失败。
- generated: true 的单元由 npm run api:generate 生成，只改 openapi/ 投影与生成器，不手改其正文；生成器保留 stage / deprecated / workflow。
- 不实现跨仓自动汇总 PR，不创建独立对外文档站，不把正文更新转换成 frontend 构建触发。
- 当前前端读取端尚未切到 v3；不得把 KV 激活成功说成线上已读取新内容。
- 不虚构账号、权限、许可证、生产承诺或版本号；不自动 git commit / push，需用户明确要求（代理定时任务按其自身授权写入）。
- 改变设计时同步更新维护文档。纯文档修改使用 npm run check 做链接与结构检查，不运行 frontend 全量构建；真机验收脚本只写 test/<run-id>/ 前缀。
