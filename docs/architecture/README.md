# 文档架构

由一个 AI 读取四个项目的固定代码版本并维护 docs 正文。英文为主，中文和俄文为翻译。Git 保存权威正文，R2 保存版本化产物，frontend 保留 Fumadocs 文档页面并动态读取。

```mermaid
flowchart LR
    A[四项目固定 SHA] --> B[AI 编辑 docs MDX 与译文]
    B --> C[PR 校验及固定 SHA 编译]
    C --> D[R2 内容包与发布指针]
    D --> E[frontend v2 reader]
    E --> F[Fumadocs 页面及搜索]
```

| 层 | 职责 |
| --- | --- |
| 业务项目 | 已核对的代码事实，不执行跨仓文档自动合并 |
| docs | 正文、导航、翻译、资源、基线、Fumadocs/Shiki 编译、发布与回滚 |
| R2 | 不可变内容包、资源、历史激活记录与 current/previous 指针 |
| frontend | 请求范围内一致的路由、正文、导航、搜索、SEO 和缓存 |

保留 `/{locale}/docs/...`，介绍页规范地址为 `/{locale}/docs`。法律页、博客、白皮书和产品 changelog 继续使用现有内容来源。

v2 的受限正文树、编译期代码高亮和 structuredData 是一份可校验的纯数据包。前端读取不依赖在线内容索引，不在 Worker 请求中编译 Markdown 或执行 JavaScript。

普通文字、导航、译文和已有组件参数变更无需重新构建 frontend。新增组件、改变属性契约或升级 rendererContract 需要先部署应用。

- [首版范围](v1-scope.md)
- [仓库目录](repository-layout.md)
- [用户目录](information-architecture.md)
- [内容契约 v2](content-contract.md)
- [编辑流程](editing.md)
- [内容发布](publishing.md)
- [发布操作](release-operations.md)
- [工具链决策](../decisions/0004-drop-tina-fumadocs-toolchain.md)
- [分支发布决策](../decisions/0005-branch-based-r2-publication.md)

147 页正文及其业务 SHA 基线保留。preview / master 分别发布到固定的 R2 桶；frontend 接入需要单独端到端验收。历史验证报告保留原时间点事实，不作为 frontend 已上线的证明。
