# 内容契约

本文件定义项目内容契约 v1。全部正文在 docs 中维护，CMS 保存可重建的索引；frontend 读取已发布的结构化内容。发布侧校验已实现于 scripts/compile.mjs，精确类型由 contracts/schema.ts 提供；frontend 的运行时适配由其 AI 实施。

Tina GraphQL 保留 `id` 字段，实际样例验证后将页面稳定标识定为 `docId`。不能直接登记同名 `id` 字段。

## 页面格式

英文、中文和俄文分别位于 content/en、content/zh-CN、content/ru，使用相同英文文件路径。新正文使用 .mdx；现有 .md 按需迁移，不能仅改后缀便假定兼容 JSX 语法。

```yaml
---
docId: concepts.prices
title: Prices
description: Understand price sides, amounts, and quantities.
kind: explanation
status: draft
sources:
  - spider
  - api
---
```

| 字段 | 规则 |
| --- | --- |
| docId | 语言无关、永久稳定；各语言各有一页，同语言唯一 |
| title、description | 必填，使用正文语言 |
| kind | tutorial、how-to、reference、explanation |
| status | draft、ready、deprecated |
| sources | 非空逻辑项目列表：spider、refinery、api、frontend；跨项目页列全部依赖 |
| translationOf | 译文必填，与英文 docId 相同 |
| sourceDigest | 译文必填，sha256: 加对应英文文件 UTF-8 / LF 字节的摘要 |

页面路径与 ID 分离，移动页面保留 docId 并添加重定向。项目来源由 sources 关联 baselines/；不能把一次 SHA 更新当成所有相关页面已自动复核。

## MDX 组件边界

docs 发布器使用 TinaCMS 的解析器把固定 Git SHA 的正文编译为结构化节点。它要求组件在 schema 中登记为 template，并在 frontend 的渲染映射中提供实现。

允许的内容是基本 Markdown、表格、代码块及登记组件，首版从已验证的 Callout 开始；Steps、FeeExample 等在加入 schema 和渲染器并验证后启用。组件名称、属性类型和默认值属于版本化契约。

正文不写 import / export、事件处理器、任意 JavaScript 函数或 frontend 内部路径。不从 CMS 获取 JavaScript 字符串后在 Worker 请求中执行。

| 变化 | 是否需要 frontend 部署 |
| --- | --- |
| 修改文字、翻译、顺序、已有页面 | 否 |
| 新增、移动或删除内容页 | 否，动态路由和导航必须支持 |
| 使用已注册组件、修改其合法属性 | 否 |
| 新增组件实现或改变属性契约 | 是，先部署兼容实现再发布内容 |
| 纯 CMS 配置或索引维护 | 视 schema 兼容性决定，不承诺永远无需应用变更 |

Tina 的 MDX 模型与任意可执行 MDX 不等价。内容初始化前用实际解析器验证表格、代码块、链接、标题、嵌套列表和组件能往返保存。

## Fumadocs 适配

保留 DocsLayout、DocsPage、侧栏及外层网站导航；替换本地 docs.toFumadocsSource() 的内容依赖。

正文通过 StaticTinaMarkdown 或等价节点适配器渲染；标题与锚点、TOC、页内跳转和搜索文本从同一结构化正文生成。代码高亮、图片和自定义组件统一走 frontend 组件映射。

不要求所有内容都通过 Fumadocs 的本地 MDX 编译器。客户 API 参考可由固定 OpenAPI 数据和已登记 API 组件显示，不直接把含 ESM import 的生成 MDX 当成 Tina 正文。

## 链接与资源

内部文档链接使用 /docs/<slug>，渲染器统一添加当前 locale。页面真实地址保持 /{locale}/docs/...。跨页锚点使用稳定规则，TOC 与标题渲染共用相同算法。

资源在 Git 的 assets/ 中保存，以 `/assets/<filename>` 引用。首版文件名只允许字母、数字、点、下划线和短横线，支持 JSON、PNG、JPEG、WebP；SVG 和远程图片暂不接受。编译器仅把有效发布页面引用的资源加入 allowlist，发布到摘要对象键，由前端按 releaseId 读取。不复制到 frontend/public，也不依赖 CMS 媒体 CDN。首批只有三个 OpenAPI JSON 下载文件。

“编辑此页”指向 docs 原始文件。模板与维护设计不作为 CMS 用户正文集合。

## 多语言

英文是权威版本；中文与俄文共用页面 ID 和相对路径，并记录英文摘要。过期译文从当前可发布集合剔除，复核后更新摘要再恢复。

缺失译文明确回退到英文，不把英文复制为伪译文。导航、搜索、sitemap、canonical 与 hreflang 依照实际可用语言生成。所有这些数据需要随内容发布更新，不能留在 frontend 构建快照中。

## 客户 API 内容

API 字段和结构来自 baselines/api.json 锁定 SHA 的公开导出。在初始化阶段由当前 AI 读取该代码版本完成导出与核对，不依赖另一个项目 AI 或现成跨仓 CI。

筛选 hidden operation，并仅纳入 roles 为空或包含 user 的客户接口；管理员专用与机器专用端点排除。清理无引用 components、扩展分组和示例，确保三语结构一致及所有引用可解析。

参考页路径保持稳定，不因函数名或 tag 改名改变 URL。文件响应、条件请求、金额精度等保留真实契约。生成的参考数据和手写教程绑定同一 API SHA。

## 发布集合

正文状态、导航和来源复核共同决定可发布集合。草稿不进入正文 API 的公开投影、导航、搜索或 sitemap，不能仅靠侧栏隐藏。

正文、TOC、页面树、搜索、语言映射与基线信息需要共同版本标识；发布一致性不是 CMS 存在就自动满足，具体流程见 publishing.md。
