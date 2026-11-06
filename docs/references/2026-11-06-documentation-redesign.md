# 2026-11-06 文档阅读路径重构

## 外部研究

实际访问日期：2026-11-06。只借鉴组织方式，不引用竞品能力作为 cs.cheap 的功能或价格依据。

| 一手资料 | 观察 | 本仓采用方式 |
| --- | --- | --- |
| [Google：Procedures](https://developers.google.com/style/procedures) | 操作步骤有顺序、说明上下文，优先简单路径，必要时交代结果 | 上手页用三段编号操作，准备、命令和结果放在同一页 |
| [Microsoft：逐步说明](https://learn.microsoft.com/en-us/style-guide/procedures-instructions/writing-step-by-step-instructions) | 动作标题便于扫描；说明操作位置，每步一个主要动作 | 登录、设置、密钥和账单都有具体位置；失败后给动作 |
| [Pricempire：API Documentation](https://pricempire.com/docs) | Quickstart 先给鉴权，再给 curl；端点可以独立查阅 | 密钥入口在首次调用前；常用查询与完整参考分开 |
| [Skinport：Getting started](https://docs.skinport.com/) | 首页直接给 base endpoint、first request 和 next steps | 保留一个最小请求及下一步，深入解释延后 |

Skinport 的首个 items 请求可匿名调用，cs.cheap 的价格接口需要密钥，不能照搬其权限前提。Pricempire 的鉴权方式和订阅规则也不能直接移植。CSFloat 官方文档域名两次读取均返回 502，因此未将第三方非官方文档当成竞品官方依据。

## 业务事实核对

保留 `baselines/` 和 OpenAPI 现有固定版本，不把本次编辑扩大为全量 API schema 升级。以下是额外阅读的工作区 HEAD，不代表部署版本，也不替代生成参考的基线。

| 项目 | 阅读 HEAD | GitHub 验证 | 阅读重点 |
| --- | --- | --- | --- |
| api | `b5235a38c6adea91a4345d807b3bb49b71f516cd` | `git ls-remote origin refs/heads/master` 匹配 | `apps/api/cscheap_api/prices/schemas.py`、`routes/prices.py`：字段、筛选、批量与导出边界 |
| frontend | `6099a126e4826dc205c29ed14f3e3e77baf98210` | 未验证；SSH 连接关闭，HTTPS 凭据不可用 | `lib/api-key-server.ts`、`lib/actions/api-key.ts`：首把密钥自动发放、重新生成 |
| spider | `6a30dfeae19a49526d612f810ad78a61791e3d25` | `git ls-remote origin refs/heads/master` 匹配 | `packages/steammarket-schema/steammarket_schema/models.py`、`views.py` 及架构：报价、下架和 fresh_at 语义 |
| refinery | `04543778b9ee931a5e03e43a1d1846a3a968ae36` | `git ls-remote origin refs/heads/master` 匹配 | `prices/merge.py`、名称合并和费用架构：报价合并、空值、官方费用 |

api、spider、refinery 工作区干净。frontend 有未跟踪 `.ai/2026-11-06/`，未作为事实依据，未修改任何业务仓。本次新增上手内容使用既有文档/固定投影已有的用户契约，并通过上述实现补充交叉核对；没有因未验证 frontend HEAD 提升基线。未使用真实用户凭据发起付费请求。

## 页面处理与设计边界

- 3 个开始使用单元重写三语正文：任务入口、首次请求、读懂返回。加入最小 curl、成功判断、常见错误、部分响应示例、下一步。
- 5 个指南补齐独立阅读的前提；单件查询补充完整筛选命令和验证方式；进阶费率操作明确替换示例 ID、先读并发序列号。
- 账号、计费、支持及概念页保留已有专题正文，重新编排入口。深入概念移到末尾的附录，费率链及其参考单列进阶。
- 55 个生成参考单元继续由既有 OpenAPI 投影生成，不手改。价格参考移到常规端点最前，普通用户无需先穿过费率操作符列表。
- 93 个单元、docId、slug 和 stage 保持不变，不推进 workflow，不制造重复页面和重定向。更新维护规范、模板、导航和信息架构。
- Git 本地改动不意味着已上线；前端读取端尚未切到 v3。本次没有提交、推送、部署或激活。

检查结果：`npm run check` 通过（退出码 0）；55 个 API 操作 × 3 语言生成一致；preview 和 production 各编译 279 页；64 项测试全部通过，无失败或跳过。`git diff --check` 通过。该检查不验证生产部署，也不保证外部网站始终可访问。
