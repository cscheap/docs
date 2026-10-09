# 用户文档目录

基线日期：2026-10-09。英文主文档、简体中文与俄文译文共用下列英文 slug；例如中文价格概念页为 `/zh-CN/docs/concepts/prices`。

全部正文由当前一个 AI 在 docs 仓库编写。下表“正文来源”表示需要查阅和核对的领域事实来源，不表示正文放在业务仓库，也不要求另一个项目 AI 参与；“复核”同样由当前 AI 跨仓完成。

首批 49 个主题已建立英文、中文、俄文正文并通过离线编译，尚未线上发布。下表保留批次说明：**扩展**有实际内容时增加，**暂缓**当前不进入发布集合。实际排序以 navigation.json 为准。

## 读者入口

| 栏目 | 读者要解决的问题 | 主要文档类型 |
| --- | --- | --- |
| Get started 开始使用 | 如何理解产品并完成第一次调用 | 教程、概览 |
| Concepts 核心概念 | 返回的数据、价格和计算结果是什么意思 | 解释、术语参考 |
| Guides 操作指南 | 怎样完成具体集成任务 | 操作指南 |
| API | 请求如何写、返回什么、出错怎么办 | 契约与参考 |
| Billing 计费 | 什么会扣费、如何计算与查询 | 解释、参考 |
| Dashboard 控制台 | 在网站上如何管理自己的账号和服务 | 操作指南 |
| Support 问题排查 | 如何诊断异常并获得帮助 | 排查指南 |

采用 Diátaxis 的文档类型区分，但网站按任务与领域设置栏目。教程集中在 `get-started`；内容量增加后才独立设置 tutorials，不预建空栏目。

## 开始使用

| 路径，省略语言和 `/docs/` | 页面 | 正文来源 | 批次 |
| --- | --- | --- | --- |
| `get-started/introduction` | 产品介绍与文档入口，保留现有路径 | docs | 首批 |
| `get-started/first-request` | 获取 API Key 并完成第一次价格请求 | docs，API 与 frontend 复核 | 首批 |
| `get-started/read-price-data` | 用一份响应识别市场、报价侧与时间 | docs，spider 与 API 复核 | 首批 |

`/{locale}/docs` 继续指向 introduction。前端接入时统一处理重定向或 canonical，不让两条地址竞争为重复正文。

## 核心概念

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

`cost-calculation` 解释计算过程，不宣称费用结果已包含在当前 `/prices` 的响应字段中。字段是否返回以 API schema 为准。

## 操作指南

| 路径 | 任务 | 正文来源 | 批次 |
| --- | --- | --- | --- |
| `guides/query-prices` | 按饰品、市场和报价侧读取价格 | api | 首批 |
| `guides/batch-prices` | 批量读取及处理部分缺失数据 | api | 首批 |
| `guides/export-prices` | 下载快照、解压并使用条件请求 | api | 首批 |
| `guides/polling-and-retries` | 设置轮询、退避与缓存策略 | api | 首批 |
| `guides/interpret-fees` | 阅读官方费率并解释成本计算 | refinery，api 复核 | 扩展 |
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

目标参考分组如下。方法与路径是 2026-10-09 代码基线的核对清单，不替代后续版本的 schema：

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
| `dashboard/fee-editor` | 自定义费率编辑器 | frontend | 暂缓 |
| `dashboard/profit-table` | 商品利润表 | frontend | 暂缓 |

客服工单、邮箱、通知、独立 API playground 等未开放能力同样不进入正式导航。管理员功能不属于这里的普通用户控制台说明。

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
- 每个 ready 页面必须有完整的前提、行为边界、相关链接和责任方；首批清单不是强制一次性全部上线的门槛。
