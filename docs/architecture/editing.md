# 单元编辑流程

代理在 `content/<section>/<page>/` 修改单元，并同步 `zh-CN.mdx` 与 `ru.mdx` 的实际翻译。Git 是唯一正文来源，KV / R2 只存可重建的发布产物。

1. 读取 `AGENTS.md`、单元 `sources` 和相关 `baselines/`，确认当前文档对应的代码版本。
2. 新单元从 `templates/unit/` 复制：`item.json` 填 `docId`、`slug`（= 目录路径）、`kind`、`sources`；`en.mdx` 只有 `title`、`description` frontmatter。英文变更后先复核译文，再把整份 `en.mdx` 的 sha256 写入各译文的 `sourceDigest`。
3. 页面移动保留 docId，更新 navigation.json、内部引用与 redirects.json。生成的 API 单元通过 `npm run api:generate` 更新，不手改。
4. 推进 `stage`：在 `workflow` 末尾追加 `{ stage, by, at, note? }`（`at` 为当前 UTC、不早于上一条），把顶层 `stage` 改为同值。不修改或删除既有条目。
5. 运行 `npm run check`。本地构建用全零 docsCommit，不具备发布资格。
6. 推送 `master`（contents API 带 `sha`、409 重试，或 `git push`）。CI 校验通过后编译并激活两个频道；`reviewed` 单元出现在 preview，`published` 单元出现在 preview 与 production。

## stage 流转

```text
draft ──→ reviewed ──→ published
  │           │            │
  └──→ held ←─┘            └──→ retired
```

| 从 | 到 | 谁 | 含义 |
| --- | --- | --- | --- |
| （新建） | draft | 采集 / 编写代理 | 正文已写，未审核；不进任何频道 |
| draft | reviewed | 审核 / 翻译代理 | 已审核并译完，进 preview |
| reviewed | published | 发布代理 | 进 production |
| 任意 | held | 任意 | 人工拦停，退出全部频道 |
| published | retired | 任意 | 退出全部频道；需要跳转时在 `redirects.json` 显式写 |

流转方向不受契约限制（`retired` 可以回到 `reviewed`），契约只要求 `workflow` 只追加、时间戳不减、末项与 `stage` 一致。`published` 页链接到非 `published` 单元会使 production 构建失败，因此降级一个被引用的单元前先处理引用它的页面。

## 代理写入契约

- 写入对象：单元目录下的 `item.json` 与 `.mdx`，必要时 `navigation.json` / `redirects.json` / `assets/`。
- GitHub contents API：`GET` 当前文件取 `sha` → `PUT` 带 `sha`（新文件不带）与 base64 内容 → 409 时重新 `GET` 并重试。一次流程推进至少同时写 `item.json` 与对应 `.mdx`；可以多次提交，CI 每次都会跑。
- 文件格式：`item.json` 两空格缩进、固定键序、末尾换行（`scripts/unit.mjs`）；`.mdx` UTF-8 / LF。
- 失败处理：CI 校验失败意味着单元写坏了契约（见[内容契约](content-contract.md)的失败清单），两个频道都不更新；修正后再推。
- 不写的内容：单元级资源目录、frontmatter 中的其他字段、`generated: true` 单元的正文。

## 正文语法

代码围栏支持语言及可选 `title="…"`。Callout 只接受字面量 `type="info"` 或 `type="warning"` 和可选 `title`。不允许 ESM、表达式、事件、原始 HTML、H1、脚注或数学公式。站内链接写 `/docs/<slug>`。

将来若需要可视化编辑，可添加只写回同一 Git 文件的编辑器。它不进入正式编译或阅读链路，也不能绕过 CI 校验。
