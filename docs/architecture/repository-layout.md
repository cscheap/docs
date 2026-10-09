# 仓库目录

正文集中在 docs。以下为首版已建立的布局。dist 和 public/admin 是生成结果，.cache 是本地证据与临时输入；均不提交。

```text
docs/
├── README.md
├── AGENTS.md
├── CONTRIBUTING.md
├── content/
│   ├── en/                       # 全部英文正文
│   │   ├── get-started/
│   │   ├── concepts/
│   │   ├── guides/
│   │   ├── api/
│   │   ├── billing/
│   │   ├── dashboard/
│   │   └── support/
│   ├── zh-CN/                    # 相同路径与页面 ID
│   └── ru/
├── navigation.json              # 共用顺序与 slug、三语栏目标题
├── assets/                       # 正文资源
├── baselines/
│   ├── spider.json
│   ├── refinery.json
│   ├── api.json
│   └── frontend.json
├── openapi/{en,zh-CN,ru}.json     # 固定 API SHA 的客户范围导出
├── redirects.json               # 显式旧路径；禁止链式/悬空重定向
├── contracts/schema.ts           # 严格 Zod AST、内容包与指针契约
├── tests/                        # 编译、渲染、发布失败/乱序/回滚合同测试
├── dist/                         # 编译预览/正式发布产物，不提交
├── tina/                         # CMS schema 与已提交的 tina-lock.json
├── package.json                  # CMS/内容编译工具，锁定实际验证版本
├── public/admin/                 # 生成的独立管理后台，不提交构建产物
├── templates/page.mdx
├── scripts/                      # 校验、导出和发布检查
├── .github/workflows/            # PR 校验与 master 内容发布
└── docs/                         # 维护设计；CMS 不作为用户正文加载
    ├── architecture/
    ├── decisions/
    └── references/
```

早期 sources.lock.json / 上游正文缓存 / frontend 内容包锁不再属于首版方案。baselines 保存代码事实来源，不驱动跨仓内容拉取。

## TinaCMS 与 frontend

小规模验证后的首版选择：CMS 配置、管理后台与内容编译器均放在 docs；TinaCloud 默认只绑定 docs 一个仓库。前端仅保存 reader、Zod 契约和组件实现，不承担 CMS schema 生成或编辑后台构建。管理后台可独立托管，不是第二个对外文档站。

`content/` 是 Tina 正文集合，`docs/`、`baselines/` 与模板不作为正文加载。CMS 中应登记所有需要往返保存的正文元数据。仅正文变化执行数据编译发布；CMS 配置变化才构建后台，frontend renderer 变化才部署应用。

frontend 目标变化范围：

```text
lib/docs/                          # 版本包读取、契约、树与搜索
components/docs/                   # 静态 AST → 现有 React 组件
app/[locale]/docs/                 # 动态叶子页面（外壳与正文同快照）及稳定外层
app/api/docs/                      # 只读搜索与版本化资源
```

当前 lib/source.ts 保留作迁移回退；legal、changelog、web3 的本地来源继续保留。具体实施交接在 frontend `.ai/2026-10-09/docs-cms-runtime-poc/`。

## 基线记录

每个 JSON 保存项目、仓库、完整 commit、核对日期和复核状态。GitHub 远端引用与本地 HEAD 已一致时记录 remote-ref-matches-local-head；不得把分支名本身当成版本。

正文 frontmatter 的 sources 列出关联项目。首次发布前，所有已启用页面必须完成这些基线上的事实复核；发布记录再绑定 docs commit、基线文件摘要与内容契约版本。
