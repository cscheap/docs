# 文档架构

用户已确定：由一个 AI 统一读取四个项目并维护 docs 正文；保留 frontend 文档页面，接受前端改造，以 CMS 内容更新实现免整站重建发布。英文为主，中文和俄文翻译。

技术方向为 **Git + TinaCMS 编辑 + R2 版本化发布 + Fumadocs 展示层**。本地解析与 workerd 渲染/发布切换已验证；TinaCloud 登录与 Git 写回、完整 Next/OpenNext 集成仍待实际接入。

```mermaid
flowchart LR
    A[一个 AI 读取四项目固定代码版本] --> B[docs 正文与项目 SHA]
    B --> C[固定 SHA 编译与发布检查]
    C --> D[R2 不可变内容包与发布指针]
    D --> E[frontend 动态读取]
    E --> F[现有 Fumadocs 文档页面]
```

## 边界

| 层 | 职责 |
| --- | --- |
| 四个业务项目 | 提供已核对的代码事实；首版无自动文档同步任务 |
| docs | 所有正文、导航、翻译、资源、基线、CMS schema、编译和发布 |
| CMS | Git 编辑和可视化后台；实时索引不作为生产发布依赖 |
| frontend | 路由、布局、结构化正文渲染、组件、目录、搜索与缓存 |

保留 /{locale}/docs/... 与现有 introduction 地址。法律页、博客、白皮书和产品 changelog 不纳入本次 CMS 迁移。

前端需要一次内容接入改造；文字、导航、译文、已有组件参数变化之后无需重新构建前端。新增组件、修改其代码或不兼容的内容模型仍需部署应用。

## 文件

- [首版范围](v1-scope.md)
- [仓库目录](repository-layout.md)
- [用户目录](information-architecture.md)
- [内容契约](content-contract.md)
- [CMS 与发布](publishing.md)
- [CMS 初始化与凭证配置](cms-setup.md)
- [当前决策](../decisions/0003-cms-editor-and-immutable-publication.md)
- [官方参考](../references/2026-10-09.md)

## 当前进度

已完成 49 个主题的三语正文、四项目事实复核、固定 API 导出、编译与发布/回滚实现。`npm run check` 验证正文、类型、生成一致性和发布合同，详见 [验证记录](../references/validation-2026-10-09.md)。

Tina 初始化已推送 master（234884d），云端集合及字段查询通过。正文与 CI 已纳入本仓，发布开关尚未启用；CMS 登录/写回、R2 staging/prod、frontend 代码接入仍待线上实施。凭证与步骤见 [发布操作](release-operations.md)。

前端计划第 2 轮评审通过；本地交接证据新增实际 schema、完整内容包样例与 writer 验证记录，原 19 个前端验收用例仍需前端 AI 完成。本地 watcher 曾未通过，因此正式编译始终读取固定 Git 文件字节，不依赖移动 CMS 索引。
