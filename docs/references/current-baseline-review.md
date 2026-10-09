# 2026-10-09 正文事实复核

读取方式：对 baselines/ 的四个完整提交执行 `git archive`，在临时只读输入目录中核对；没有把业务仓工作区未提交内容作为正文依据。以下是代码事实复核，不是生产部署证明。由当前同一个 AI 完成，没有委派项目 AI。

## API

提交 `dda4f783d436e2988c023313b3affa961e9fabf7`。

- [价格路由](https://github.com/senjianlu/cscheap-api/blob/dda4f783d436e2988c023313b3affa961e9fabf7/apps/api/cscheap_api/routes/prices.py)：单品空结果/404、批量顺序及重复、导出文件和条件请求。
- [价格 schema](https://github.com/senjianlu/cscheap-api/blob/dda4f783d436e2988c023313b3affa961e9fabf7/apps/api/cscheap_api/prices/schemas.py)：字段、约束、CSCP、十进制字符串与时间戳。
- [来源选择](https://github.com/senjianlu/cscheap-api/blob/dda4f783d436e2988c023313b3affa961e9fabf7/apps/api/cscheap_api/prices/repository.py)：在售、第一方、fresh_at 的优先级。
- [端点元数据](https://github.com/senjianlu/cscheap-api/blob/dda4f783d436e2988c023313b3affa961e9fabf7/apps/api/cscheap_api/endpoint_meta.py)与 [计费](https://github.com/senjianlu/cscheap-api/blob/dda4f783d436e2988c023313b3affa961e9fabf7/apps/api/cscheap_api/billing.py)：13 个普通用户/匿名操作，固定窗口、订阅豁免、成功后扣费。
- [账号视图](https://github.com/senjianlu/cscheap-api/blob/dda4f783d436e2988c023313b3affa961e9fabf7/apps/api/cscheap_api/user_view.py)与 routes/me.py：账户点数与响应计费提示的区别、异步快照。
- routes/meta.py、health.py、status.py、websites.py、currencies.py 及三语 api_docs：通过 create_app / localized_openapi 离线导出，未执行 lifespan，socket 连接被显式禁止。按非 hidden 且 roles 为空或包含 user 过滤；移除内部扩展、示例并剪裁引用闭包。

特别处理：服务自身 `/endpoints` 仍可能列出非用户操作，正文没有错误宣称它是 docs 过滤后的目录。公开参考不包含 /sync 或管理写入。导出 304 不扣点但限速照计；200 文件未变仍按正常规则计费。

## Spider

提交 `bb36401c192d1476eaf2b4e722245dd4b18253d3`。

- [价格流](https://github.com/senjianlu/steammarket-spider/blob/bb36401c192d1476eaf2b4e722245dd4b18253d3/docs/architecture/price-stream.md)与 items.md：市场/来源、原始名称、观测时刻、价格与实例的区别。
- [视图](https://github.com/senjianlu/steammarket-spider/blob/bb36401c192d1476eaf2b4e722245dd4b18253d3/packages/steammarket-schema/steammarket_schema/views.py)：fresh_at 综合变化/观测/完成轮次。
- [ItemValue](https://github.com/senjianlu/steammarket-spider/blob/bb36401c192d1476eaf2b4e722245dd4b18253d3/packages/steammarket-schema/steammarket_schema/models.py)：每日估值、几何中间价、单边半价差回填、不确定度。

未请求第三方市场、未复制 HAR、内部基础设施配置或账号数据。来源文档中关于 refinery 仍为旧 schema 的时点说明已经过时，采用本次 refinery 固定代码，不沿用该旧说明。

## Refinery

提交 `5237c1229f23d6684e4fc2e46a6b67d642a06ea4`。

- [名称解析](https://github.com/senjianlu/steammarket-refinery/blob/5237c1229f23d6684e4fc2e46a6b67d642a06ea4/apps/server/refinery_server/names/resolver.py)：按游戏、一步别名、字典接受/排除/未知。
- [聚合](https://github.com/senjianlu/steammarket-refinery/blob/5237c1229f23d6684e4fc2e46a6b67d642a06ea4/apps/server/refinery_server/prices/merge.py)：最低价、数量与 flags。
- [费用规则](https://github.com/senjianlu/steammarket-refinery/blob/5237c1229f23d6684e4fc2e46a6b67d642a06ea4/docs/architecture/06-fees.md)与 fees/engine.py：三档、空槽与链 0、入口汇率换算、Decimal 舍入、不可用语义。对外价格 schema 不暴露内部三档。

未把内部管理页、利润筛选或诊断操作写成用户可用产品。

## Frontend

提交 `01547868bdd0d87d13815e9d60938c27a8beaa50`。

- [账号门控](https://github.com/senjianlu/cscheap-frontend/blob/01547868bdd0d87d13815e9d60938c27a8beaa50/lib/account-status.ts)、auth.ts、actions/account.ts、dashboard/settings/page.tsx：真实邮箱验证、登录/关联、删除入口限未完善账号。
- [密钥发放](https://github.com/senjianlu/cscheap-frontend/blob/01547868bdd0d87d13815e9d60938c27a8beaa50/lib/api-key-server.ts)与 actions/api-key.ts：自动首发、单活跃密钥、重新生成撤销旧 key、五分钟冷却、可再次复制。
- [产品](https://github.com/senjianlu/cscheap-frontend/blob/01547868bdd0d87d13815e9d60938c27a8beaa50/lib/plans.ts)、billing/fulfill.ts、complete-order.ts、actions/billing.ts 及 docs/architecture/billing.md：预付费、顺延时段、钱包与点数、待付/取消/迟到款。
- billing/checkin.ts：验证与解锁前提、UTC 每日一次；不是所有用户立即可用。
- components/landing/nav-tabs.ts、signature-mark.tsx：当前公开社区入口。dashboard/tickets、notifications、mail 仍有占位，未将其写成可用工单系统。

发现旧 components/landing/playground-curl-panel.tsx 含 `/v1/price` 示例，与固定 API `/prices` 不符；正文采用 API 实际路由，前端修复作为交接发现记录，不修改其业务源码。

## 复核边界

49 个英文主题及其中文、俄文译文覆盖当前范围。三语接口说明来源于固定 API 自带的三语描述；参数、请求、响应与模型从同一 schema 生成。手工主题按代码事实撰写，未增加 SLA、弃用周期、自动续费或生产部署承诺。外部邀请链接只核对其为已提交的公开入口，不保证第三方服务持续可用。

`documentationReview: reviewed` 表示上述事实来源已复核，不表示 CMS 登录、Git 写回、R2 线上发布或 frontend 集成已验收。
