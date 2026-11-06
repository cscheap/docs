# 用户文档目录

基线日期：2026-10-09。英文主文档、简体中文与俄文译文共用下列英文 slug；例如中文价格概念页为 `/zh-CN/docs/concepts/prices`。

全部正文由当前一个 AI 在 docs 仓库编写。下表“正文来源”表示需要查阅和核对的领域事实来源，不表示正文放在业务仓库，也不要求另一个项目 AI 参与；“复核”同样由当前 AI 跨仓完成。

当前共 93 个单元 × 3 语种 = 279 页（其中 55 个 API 参考单元由生成器生成），全部 `stage: published`。下表保留批次说明：**扩展**有实际内容时增加，**暂缓**当前不进入发布集合。实际排序以 navigation.json 为准。

## 读者入口（2026-11-06 调整）

| 顺序 | 栏目 | 用户任务 |
| --- | --- | --- |
| 1 | 开始使用 | 了解用途 → 完成第一次请求 → 读懂返回 |
| 2 | 常用操作 | 单件、批量、导出、定期刷新 |
| 3 | 账号与费用 | 登录、密钥、购买、消耗、设置 |
| 4 | 问题排查 | 根据错误或异常找到下一步 |
| 5 | API 参考 | 查协议和参数；价格接口排在端点参考最前 |
| 6 | 进阶：自定义费率 | 需要个人费率时再读工作区、链和操作符 |
| 7 | 附录：概念与原理 | 按需了解名称、币种、时间、费用和估值 |

`navigation.json` 是展示顺序的权威。保留全部 93 个单元和既有 slug，因此无需改外部链接或增加重定向。栏目名称不等于物理目录：`concepts/` 显示为附录；`dashboard/` 和 `billing/` 合为账号与费用入口；费率相关指南和参考集中在进阶栏目。只有登记的 Callout 组件，不增加 frontend 组件依赖。

教程使用结果、准备、操作、检查、排错、下一步的结构，见[写作规范](writing-guide.md)。入门主线不要求读完概念；遇到 `null`、扣费或币种等会改变结果判断的条件，在操作页就地说明。下文是页面职责与历史范围清单，不是导航排序。

## 开始使用

| 路径，省略语言和 `/docs/` | 页面 | 正文来源 | 批次 |
| --- | --- | --- | --- |
| `get-started/introduction` | 产品介绍与文档入口，保留现有路径 | docs | 首批 |
| `get-started/first-request` | 获取 API Key 并完成第一次价格请求 | docs，API 与 frontend 复核 | 首批 |
| `get-started/read-price-data` | 用一份响应识别市场、报价侧与时间 | docs，spider 与 API 复核 | 首批 |

`/{locale}/docs` 继续指向 introduction。前端接入时统一处理重定向或 canonical，不让两条地址竞争为重复正文。

## 附录：概念与原理

| 路径 | 页面边界 | 正文来源 | 批次 |
| --- | --- | --- | --- |
| `concepts/items` | 饰品标识、名称与游戏范围 | spider | 首批 |
| `concepts/markets-and-sources` | 市场、数据来源与网站目录的区别 | spider、frontend | 首批 |
| `concepts/prices` | 报价侧、原始金额、数量语义 | spider | 首批 |
| `concepts/freshness` | 更新时间、确认时间、新鲜度与下架含义 | spider | 首批 |
| `concepts/valuation` | CSCP 估值的定义与适用边界 | spider | 首批 |
| `concepts/normalization` | 名称识别、合并及无效数据处理 | refinery | 首批 |
| `concepts/currencies` | 货币标识、换算方向与官方目录 | api | 首批 |
| `concepts/marketplace-fees` | 充值、出售、提现费率的定义与未知状态 | api | 首批 |
| `concepts/cost-calculation` | 原价经过换币与费率得到成本的过程 | refinery，api 复核 | 首批 |
| `concepts/glossary` | 术语索引，简释并链接权威概念页 | docs | 首批 |
| `concepts/liquidity-and-volatility` | 流动性与波动指标 | spider | 扩展，先核定对外范围 |
| `concepts/profit-and-filtering` | 商品筛选与收益判定 | refinery 主笔，spider 与 api 复核 | 暂缓 |

refinery 维护费用应用和数据筛选说明；官方费率定义由 API 维护。目前部分利润与热度计算实现归 spider，产品筛选能力也尚未完整开放，不能把它们描述成 refinery 已提供的公开接口。未来由 refinery 主笔用户说明时，仍需计算实现维护方核对。

`cost-calculation` 解释 `buy_amount`、`sale_amount`、`payout_amount` 的官方费用计算及空值；字段以客户 OpenAPI 为准，个人费率不改变这些报价金额。

## 操作指南

| 路径 | 任务 | 正文来源 | 批次 |
| --- | --- | --- | --- |
| `guides/query-prices` | 按饰品、市场和报价侧读取价格 | api | 首批 |
| `guides/batch-prices` | 批量读取及处理部分缺失数据 | api | 首批 |
| `guides/export-prices` | 下载快照、解压并使用条件请求 | api | 首批 |
| `guides/polling-and-retries` | 设置轮询、退避与缓存策略 | api | 首批 |
| `guides/interpret-fees` | 阅读官方费率并解释成本计算 | refinery，api 复核 | 扩展 |
| `guides/customize-fees` | 用 API 维护自己的费率链：读取费率工作区、查找或搭建链、试算、绑定与恢复官方费率 | api | 第五批（2026-10-26） |
| `guides/filter-items` | 按商品条件完成筛选 | refinery，spider 复核 | 暂缓 |

这些页面写操作步骤和可验证结果，参数表链接到接口参考。SDK 教程等 SDK 有可维护发布物后再增加；首批采用 HTTP 示例。

## API

| 路径 | 内容 | 正文来源 | 批次 |
| --- | --- | --- | --- |
| `api/overview` | 服务地址、公开范围、请求基本约定 | api | 首批 |
| `api/authentication` | 用户 API Key 的使用方式 | api | 首批 |
| `api/responses` | JSON 信封、金额、时间、空值及文件响应例外 | api | 首批 |
| `api/errors` | 错误分类与客户端处理原则 | api | 首批 |
| `api/rate-limits` | 限速规则、响应信息与重试 | api | 首批 |
| `api/versioning` | 兼容性、弃用与迁移约定 | api | 首批，记录现状，不虚构兼容性承诺 |
| `api/reference/...` | 下列接口参考，从客户 schema 生成 | api 生成 | 首批 |

目标参考分组如下。方法与路径是 2026-10-09 代码基线的核对清单（费率部分为 2026-10-26 基线 `75610b5`），不替代后续版本的 schema：费率部分只收用户可用的操作，管理员专用的 officialize、`scope=official` 提权与 `/sync` 接口不公开，接口说明在「Administrators」小节处截断，`scope` 查询参数由生成器去掉：

| 参考页路径，前缀 `api/reference/` | 方法与路径 |
| --- | --- |
| `prices/get-price` | `GET /prices` |
| `prices/batch-prices` | `POST /prices/batch` |
| `prices/export-prices` | `GET /prices/export` |
| `markets/list-markets` | `GET /websites` |
| `markets/get-market` | `GET /websites/{code}` |
| `markets/get-fees` | `GET /websites/{code}/fee-schedule` |
| `currencies/list-currencies` | `GET /currencies` |
| `currencies/get-currency` | `GET /currencies/{currency_id}` |
| `account/get-account` | `GET /me` |
| `platform/get-config` | `GET /config` |
| `platform/list-endpoints` | `GET /endpoints` |
| `platform/get-health` | `GET /health` |
| `platform/get-status` | `GET /status` |
| `fees/get-fee-workspace` | `GET /fee-workspace` |
| `calculation-chains/list-chains` | `GET /calculation-chains` |
| `calculation-chains/create-chain` | `POST /calculation-chains` |
| `calculation-chains/search-chains` | `GET /calculation-chains/search` |
| `calculation-chains/validate-chain` | `POST /calculation-chains/validate` |
| `calculation-chains/preview-chain` | `POST /calculation-chains/preview` |
| `calculation-chains/get-chain` | `GET /calculation-chains/{calculation_chain_id}` |
| `calculation-chains/update-chain` | `PUT /calculation-chains/{calculation_chain_id}` |
| `calculation-chains/deprecate-chain` | `POST /calculation-chains/{calculation_chain_id}/deprecate` |
| `calculation-chains/list-chain-events` | `GET /calculation-chains/{calculation_chain_id}/events` |
| `calculation-chains/fork-chain` | `POST /calculation-chains/{calculation_chain_id}/fork` |
| `calculation-chains/list-chain-revisions` | `GET /calculation-chains/{calculation_chain_id}/revisions` |
| `calculation-chains/get-chain-revision` | `GET /calculation-chains/{calculation_chain_id}/revisions/{revision}` |
| `fee-operators/list-fee-operators` | `GET /fee-operators` |
| `fee-operators/create-fee-operator` | `POST /fee-operators` |
| `fee-operators/get-fee-operator` | `GET /fee-operators/{op_id}` |
| `fee-operators/update-fee-operator` | `PUT /fee-operators/{op_id}` |
| `fee-operators/delete-fee-operator` | `DELETE /fee-operators/{op_id}` |
| `fee-operators/fork-fee-operator` | `POST /fee-operators/{op_id}/fork` |
| `fee-operators/list-fee-operator-revisions` | `GET /fee-operators/{op_id}/revisions` |
| `convert-operators/list-convert-operators` | `GET /convert-operators` |
| `convert-operators/create-convert-operator` | `POST /convert-operators` |
| `convert-operators/get-convert-operator` | `GET /convert-operators/{op_id}` |
| `convert-operators/update-convert-operator` | `PUT /convert-operators/{op_id}` |
| `convert-operators/delete-convert-operator` | `DELETE /convert-operators/{op_id}` |
| `convert-operators/fork-convert-operator` | `POST /convert-operators/{op_id}/fork` |
| `convert-operators/list-convert-operator-revisions` | `GET /convert-operators/{op_id}/revisions` |
| `convert-groups/list-convert-groups` | `GET /convert-operator-groups` |
| `convert-groups/create-convert-group` | `POST /convert-operator-groups` |
| `convert-groups/get-convert-group` | `GET /convert-operator-groups/{op_id}` |
| `convert-groups/update-convert-group` | `PUT /convert-operator-groups/{op_id}` |
| `convert-groups/delete-convert-group` | `DELETE /convert-operator-groups/{op_id}` |
| `convert-groups/fork-convert-group` | `POST /convert-operator-groups/{op_id}/fork` |
| `convert-groups/list-convert-group-revisions` | `GET /convert-operator-groups/{op_id}/revisions` |
| `bindings/list-bindings` | `GET /website-calculation-chain-bindings` |
| `bindings/set-binding` | `PUT /website-calculation-chain-bindings/{website_code}/{purpose}` |
| `bindings/reset-binding` | `DELETE /website-calculation-chain-bindings/{website_code}/{purpose}` |
| `my-currencies/list-my-currencies` | `GET /me/currencies` |
| `my-currencies/create-my-currency` | `POST /me/currencies` |
| `my-currencies/get-my-currency` | `GET /me/currencies/{code}` |
| `my-currencies/update-my-currency` | `PUT /me/currencies/{code}` |
| `my-currencies/delete-my-currency` | `DELETE /me/currencies/{code}` |

API 导出器维护 operation 到文档路径的显式映射，避免函数名、tag 或自动生成的 operationId 变化导致链接变化。`GET /endpoints` 的真实返回范围按 API 行为说明；不能因为文档筛选了接口，就声称该端点也自动采用相同筛选。

内部同步、管理员操作、部署和存储细节不列入客户文档。筛选规则见[内容契约](content-contract.md)。

## 计费

| 路径 | 页面边界 | 正文来源 | 批次 |
| --- | --- | --- | --- |
| `billing/credits` | credits 与请求消耗的关系 | api | 首批 |
| `billing/request-costs` | 单次、批量、导出和失败请求的计量语义 | api | 首批 |
| `billing/plans` | 套餐、有效期及额度获取规则；具体售价引用定价页 | frontend | 首批 |
| `billing/balance-and-usage` | API 余额与控制台显示的含义、更新时间差异 | api，frontend 复核 | 首批 |

API 维护 consume 的规则，frontend 维护 grant、购买与订阅操作。计费页不重复第三方市场的交易手续费说明，也不手工复制易变的端点价目表。

## 控制台

| 路径 | 操作 | 正文来源 | 批次 |
| --- | --- | --- | --- |
| `dashboard/account` | 登录、完善账号及验证 | frontend | 首批 |
| `dashboard/api-keys` | 创建、查看与吊销 API Key | frontend | 首批，按实际支持的动作编写 |
| `dashboard/billing` | 购买、充值、订阅与支付状态 | frontend | 首批 |
| `dashboard/settings` | 个人资料与偏好 | frontend | 首批 |
| `dashboard/market-fees` | 市场费率工作区：市场矩阵、计算链编辑、本地草稿、保存与适用、历史与副本、订阅期外只读 | frontend；API 侧的费率口径由 `concepts/marketplace-fees` 说明 | 2026-10-25 加入（原规划 `dashboard/fee-editor`） |
| `dashboard/profit-table` | 商品利润表 | frontend | 暂缓 |

邮箱、通知（提醒）、独立 API playground 等未开放能力同样不进入正式导航；客服工单已开放（2026-10-14），入口与规则写在 `support/contact`。管理员功能不属于这里的普通用户控制台说明。

## 问题排查

| 路径 | 问题 | 正文来源 | 批次 |
| --- | --- | --- | --- |
| `support/authentication` | 无法认证或没有访问权限 | api，frontend 复核 | 首批 |
| `support/missing-or-stale-data` | 空结果、缺失、下架或旧数据 | docs，spider / refinery / api 复核 | 首批 |
| `support/billing` | 扣费、余额和支付异常的排查入口 | docs，api 与 frontend 复核 | 首批 |
| `support/service-status` | 查看当前服务状态并判断下一步 | frontend | 首批 |
| `support/contact` | 如何提交可复现的问题 | docs | 首批，使用已核对的网站社区入口 |

常见问题先放在相关页面；只有出现独立检索需求时再单列 FAQ。状态页、定价页、changelog、法律条款使用站内链接，不在 docs 重建一套内容。

## 发布与导航规则

- 一级栏目固定上述七项；首期仅显示已有可发布页面的栏目。
- 导航显式列出页面，避免使用全局 `...` 自动暴露新文件。
- 单页只出现一个主导航位置，其他栏目通过正文链接引用。
- 草稿、未确认上线能力、未翻译内容都不得因目录存在而自动发布。
- 每个 published 页面必须有完整的前提、行为边界、相关链接和责任方；首批清单不是强制一次性全部上线的门槛。
