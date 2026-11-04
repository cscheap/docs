# 文档维护规范

目前全部正文由 AI 代理在本仓维护（手写与 API 参考生成器都由 Claude Code 操作；后续采集、审核、翻译代理各用自己的定时任务写入）。各业务项目提供事实依据，不需要等待项目 AI 提交文档；跨项目合并机制建立前持续采用此方式。

## 编写与复核

1. 读取页面涉及的项目，核对代码、测试和现有架构说明；不把计划中的功能当成现状。
2. 固定 baselines/ 中的 GitHub SHA。对比工作区与该 SHA；未提交代码不作为该版本的既成事实。
3. 在 `content/<section>/<page>/` 建立或修改单元：`item.json` 声明 `docId`、`slug`、`kind`、`sources`；英文正文写在 `en.mdx`。跨领域页面由同一代理同时核对所有相关项目。
4. 完成中文与俄文译文，各自写入整份 `en.mdx` 的 `sourceDigest`。
5. 更新 `navigation.json`（每个单元都必须列出）、引用、资源和 API 导出物；每次状态推进在 `item.json.workflow` 追加一条记录并把 `stage` 改为该条的值。
6. 推送到 `master`。CI 校验通过后从事件 SHA 编译两个频道并激活：`reviewed` 单元出现在 preview，`published` 单元出现在 preview 与 production；不请求 frontend 重建或 revalidation。校验失败则两个频道都不更新。

独立变更使用独立提交或 PR；必须一起生效的业务变化才组成联合变更。`published` 页只能链接到 `published` 单元，否则 production 构建失败。

## 事实责任

| 领域 | 需要读取的项目 |
| --- | --- |
| 饰品、报价、来源、新鲜度、估值 | spider |
| 标准化、费用应用、数据筛选解释 | refinery，并按实际计算归属复核 spider / api |
| API、鉴权、限流、credits、官方费率定义 | api |
| 账号、API Key 管理、购买订阅与控制台操作 | frontend |

具体页面见[用户文档目录](docs/architecture/information-architecture.md)。所有事实责任最终都由当前代理完成阅读和复核，不创建虚构的团队审批人。

## 写作

- 一页解决一个主要问题，区分教程、操作指南、参考与解释（`item.json.kind`）。
- 正文标题来自 frontmatter `title`；内容从二级标题开始，不写 H1。
- 金额、时间、数量、百分比写清单位、精度及空值含义。
- 示例数字明确为示例；当前费率和售价引用权威接口或定价页。
- 接口字段由固定版本的客户 OpenAPI 提供；正文解释行为，不手写第二套参数结构。
- 图片写 alt，代码块标语言，示例使用占位凭据；站内链接写 `/docs/<slug>`。
- 使用[单元模板](templates/unit/)，语法见[内容契约](docs/architecture/content-contract.md)。

## 编辑入口

代理直接编辑单元文件并推送 `master`（GitHub contents API 带 `sha`、409 重试，或 `git push`）。“编辑此页”链接本仓原始正文。生成的 API 参考（`generated: true`）改其 schema / 生成配置后运行 `npm run api:generate`，不编辑生成结果；KV 对象与前端缓存都不是正文权威源。

修改后运行 `npm run check`。维护步骤见[编辑流程](docs/architecture/editing.md)与[发布操作](docs/architecture/release-operations.md)。不需要可视化后台或内容索引服务。

译文修改不能只机械更新 `sourceDigest`。必须先按新英文复核语义，再计算整份 `en.mdx`（含 frontmatter，UTF-8 / LF）的 sha256 写入对应译文。过期译文在构建中排除并报告警告，访问时 307 到英文；不以失败的翻译阻止其他已复核语言发布。
