# Git 与 MDX 编辑流程

AI 在 `content/en/` 修改正文，并同步 `zh-CN` 与 `ru` 的实际翻译。Git 是唯一正文来源，R2 只存可重建的发布产物。

1. 读取 `AGENTS.md`、页面 `sources` 和相关 `baselines/`，确认当前文档对应的代码版本。
2. 使用 `templates/page.mdx` 的字段；英文变更后先复核译文，再更新英文文件字节的 sourceDigest。
3. 页面移动保留 docId，更新 navigation.json、内部引用与 redirects.json。生成 API 页通过 `npm run api:generate` 更新。
4. 运行 `npm run check`。本地预览包用全零 docsCommit，不具备发布资格。
5. 在 docs PR 中一起提交该行为涉及的正文、译文、基线和导航；独立变化使用独立 PR。
6. 合入 preview 后 CI 将该固定 SHA 编译并发布到预览桶；验收后合入 master 发布生产桶。frontend 后续请求读取其绑定桶的新内容。

代码围栏支持语言及可选 `title="…"`。Callout 只接受字面量 `type="info"` 或 `type="warning"` 和可选 `title`。不允许 ESM、表达式、事件、原始 HTML、脚注或数学公式。

将来若需要可视化编辑，可添加只写回同一 Git 文件的编辑器。它不进入正式编译或阅读链路，也不能绕过 PR 校验。
