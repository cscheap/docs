# 内容契约 v2

精确契约位于 `contracts/schema.ts`，导出 `BundleV2`、`PageV2`、`BodyNode`、`PointerV1`，保持 `zod/v3` 兼容入口。Git 是正文来源，前端只读取通过契约验证的 R2 纯数据包。

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

## 编译与正文边界

解析使用 unified 11 / remark-parse 11 / remark-gfm 4 / remark-mdx 3；Fumadocs 16.7.9 的 remarkHeading 与 remarkStructure 生成 TOC、标题 ID 和 structuredData。Shiki 4.2.0 在编译时使用 github-light / github-dark 双主题高亮，不把高亮工作留给前端请求。

Bundle 的 `schemaVersion` 与 `rendererContract` 均为 2；compiler 记录 `version`、实际依赖版本 `toolchain` 和 `themes`，它们是信息字段，不作为前端兼容闸门。Pointer 与 Published 的 schemaVersion 仍为 1。

正文树只允许四种节点：

- Text：`{ type: 'text', value }`。
- Element：受限 hast 形状，允许基本 Markdown、h2–h6、列表和表格。属性按标签严格校验；标题必须有 id，链接只有 href/title，图片只有 src/alt/title。
- CodeBlock：语言、可选 title、最多 64 项双主题颜色调色板及 `[文本, 颜色下标]` 行 token；`-1` 代表无色，拼接后保留原始代码文本。未知语言作为 text 输出并记录 warning。
- Component：仅 Callout，属性只允许字面量 type（info / warning）和可选 title；内容位于 children，不重复存储。

节点最大深度 64；不保留 position、空 properties 或块元素间的纯空白。颜色严格限定十六进制值，任意标签、事件、style/className、外部图片均拒绝。ESM、MDX 表达式、原始 HTML、H1、任务列表、脚注、数学语法同样拒绝。

代码围栏只支持 `title="…"` 元数据。标题 ID 直接使用 Fumadocs 的 github-slugger 结果，包括重复标题编号；自定义 `[#id]` 必须合法且唯一。TOC 来自同一插件结果。

每页 `structuredData` 包含 `headings: {id, content}[]` 和 `contents: {heading?, content}[]`，由 remarkStructure 默认选项生成。没有顶层 search 数据副本；frontend 按当前包的 structuredData 建立搜索索引。

新增组件、节点或不兼容属性变化需先部署 frontend；正文或已注册属性变化无需应用部署。前端用节点白名单映射至现有 React 组件，绝不执行内容中的代码或 HTML 字符串。

## 链接与资源

源码内部链接使用 `/docs/<slug>` 或显式语言路径。编译期校验目标和锚点并输出最终 `/{locale}/docs[/slug][#id]`；目标缺译或过期时直接写入英文路径。同页 `#id` 必须命中 TOC；介绍页规范路径是 `/{locale}/docs`，前端不再改写文档链接。

资源在 Git 的 assets/ 中保存，以 `/assets/<filename>` 引用。首版文件名只允许字母、数字、点、下划线和短横线，支持 JSON、PNG、JPEG、WebP；SVG 和远程图片暂不接受。编译器仅把有效发布页面引用的资源加入 allowlist，发布到摘要对象键，由前端按 releaseId 读取。不复制到 frontend/public。首批只有三个 OpenAPI JSON 下载文件。

资源逻辑路径保留 `/assets/<file>`，前端按当前 releaseId 改写为 `/api/docs/assets/<releaseId>/<file>`；只能读取包中登记的资源。“编辑此页”指向 docs 原始文件，模板和维护设计不进入用户正文。

## 多语言

英文是权威版本；中文与俄文共用页面 ID 和相对路径，并记录英文摘要。过期译文从当前可发布集合剔除，复核后更新摘要再恢复。

缺失译文明确回退到英文，不把英文复制为伪译文。导航、搜索、sitemap、canonical 与 hreflang 依照实际可用语言生成。所有这些数据需要随内容发布更新，不能留在 frontend 构建快照中。

## 客户 API 内容

API 字段和结构来自 baselines/api.json 锁定 SHA 的公开导出。在初始化阶段由当前 AI 读取该代码版本完成导出与核对，不依赖另一个项目 AI 或现成跨仓 CI。

筛选 hidden operation，并仅纳入 roles 为空或包含 user 的客户接口；管理员专用与机器专用端点排除。清理无引用 components、扩展分组和示例，确保三语结构一致及所有引用可解析。

参考页路径保持稳定，不因函数名或 tag 改名改变 URL。文件响应、条件请求、金额精度等保留真实契约。生成的参考数据和手写教程绑定同一 API SHA。

## 发布集合

正文状态、导航和来源复核共同决定可发布集合。草稿不进入正文 API 的公开投影、导航、搜索或 sitemap，不能仅靠侧栏隐藏。

正文、TOC、页面树、搜索、语言映射与基线信息需要共同版本标识；包原始 UTF-8 字节的 SHA256 是 releaseId；指针 16 KiB、单页 256 KiB、包 8 MiB、资源 5 MiB 的硬上限保持不变，具体流程见 publishing.md。
