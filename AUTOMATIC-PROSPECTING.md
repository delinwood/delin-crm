# 自动获客：使用与部署

## 业务员怎样使用

1. 在「找客户」进入「自动获客工作台」。
2. 输入目标国家，可加城市；选择1至3类产品及进口、批发、分销、工程采购类型。
3. 设置5至50家候选上限，确认公开搜索说明后开始。每任务最多6个基础搜索词，可能少于所填数量。
4. 服务器按分钟分批搜索和读官网。可以离开页面，之后刷新查看；每公司最多2页。
5. 筛选优先核实、有公开邮箱或电话的公司，打开来源审查公司身份、产品和B端资格。分数不是采购量或真实进口排名。
6. 填写真实公司名、核实后的国家、客户类型、销售产品及采购匹配依据，逐项审查联系方式后导入。没有公开的信息留空；不要根据域名拼造邮箱。
7. 员工导入到自己的客户，老板可以导入公海。全公司网站、名称和电话查重；已归他人的客户只提示重复，不透露详情。
8. 纯零售、产品不符、国家不符、无法核实身份的候选可标记淘汰，并保存原因和来源。导入不自动发信。

## 免费服务约束

- 搜索顺序：Tavily Free → Firecrawl Free → SerpAPI Free → Brave Search。只走已配置且仍有免费额度的来源。某一个免费额度用尽后，同一条查询改用下一个来源。不会自动付费，不会自动充值。
- Tavily 仍是主源：Basic Search，关闭自动参数、AI 答案和原始全文。沿用 `/usage` 核对：Researcher/Free、`plan_limit` 不超过 1000、`paygo_limit` 与 `paygo_usage` 按现有规则视为 0。公司月度尝试上限不在本文件写死，迁移会读取当时已经安装的 `crm_discovery_claim`（主线目前是 900；若已先执行把上限改为 980 的迁移，则沿用 980）。
- Firecrawl 只接受免费计划（`planCredits` 不超过 1000，且余额不超过该额度）。搜索 10 条按 2 积分计入，不附带付费抓取选项。官网读取仍先用 Jina；Jina 失败时才用 Firecrawl 免费抓取一页，按 1 积分计入。
- SerpAPI 只接受免费计划（月费为 0、每月不超过 250 次、计划名称含 Free）。`plan_searches_left` 用尽后停止，即使账户里还有增购次数也不调用。
- Brave 只按约 1000 次免费查询计入。CRM 不调用充值或自动续费接口；账户侧的 auto-reload 必须保持关闭。`BRAVE_STORAGE_RIGHTS_OK` 不是 `true` 时，Brave 摘录、标题和原文证据不写入候选表，只在当次内存里参与排序并保留网址。
- SearXNG 只在 `crm_search_providers` 留注册位，`in_failover=false`，本版不请求。Companies House 不是发现搜索源，不在切换链里。
- 只传产品、国家、城市、买家类型；不传CRM内部资料、Gmail内容或员工授权令牌。地板和墙板关键词、进口商/分销商/批发商/工程采购商筛选不变。
- 网页：复用Jina免密钥Reader及Google公开DNS的安全读取，仅处理公开网页，禁止内网、IP、短链、社交登录、文件、账号页面和带查询参数的网址。
- 账号滚动24小时最多10个任务、3个未完成任务。保留尝试不等于服务商确认扣费。
- 持久化预约外部请求；超时或进程中断不重复搜索。用户可暂停、继续、取消；已经提交的请求无法撤销，来源保留。
- 不创建自动充值，不绑定卡，不购买额度，不自动选择付费后备服务。免费额度不保证有效客户数量。

## 部署顺序

1. 保存原线上版本；在SQL编辑器执行 `supabase/migrations/20261024010000_automatic_prospecting.sql`（事务）。
2. 发布现有 `crm-mail` 函数，包含 `discovery.ts`、`research.ts`、`inbound.ts` 和共享邮件合并代码。使用控制台单文件编辑器时，需先合并模块；不要将API密钥写入部署源码。
3. 现有Mail worker每分钟处理一阶段获客任务；现有收发信和权限保持。新搜索默认关闭。
4. 发布 `js/v_discovery.js`、`js/v_prospect.js` 和 `index.html`。保留原有其他脚本。
5. 老板自行完成各免费账号的条款确认。密钥只放在 Supabase Edge Function 的环境变量里，不能写入 Git、网页或浏览器。不要打开任何自动充值。Brave 账户如需绑卡，预充和 auto-reload 都保持关闭。需要的变量：
   - 已有：`TAVILY_API_KEY`、`TAVILY_FREE_SEARCH_ENABLED=true`
   - `FIRECRAWL_API_KEY`、`FIRECRAWL_FREE_SEARCH_ENABLED=true`
   - `SERPAPI_API_KEY`、`SERPAPI_FREE_SEARCH_ENABLED=true`
   - `BRAVE_SEARCH_API_KEY`、`BRAVE_FREE_SEARCH_ENABLED=true`
   - `BRAVE_STORAGE_RIGHTS_OK=true` 才允许把 Brave 摘录写入 CRM；默认不设置或非 `true` 时不入库
   只配置了密钥但开关不是 `true` 时，该来源显示为未配置，不会被调用。
6. 检查Pages部署状态及实际「找客户 → 自动获客」入口。服务未配置时明确显示未连接，开始按钮禁用。主源用尽但备用源仍有免费额度时，开始按钮仍可使用。
7. 本功能的数据库迁移是 `supabase/migrations/20261108030000_free_search_failover.sql`。在老板批准前不要对生产库执行，也不要为此发布边缘函数或页面。若另有把 Tavily 月度上限改为 980 的迁移，先执行那一版，再执行本迁移，这样上限会被读出来并保留。不要在本迁移之后再执行会整段覆盖 `crm_discovery_claim` 的旧脚本。

官方参考（2026-10-23核对）：
- https://www.tavily.com/pricing
- https://docs.tavily.com/documentation/api-credits
- https://docs.tavily.com/documentation/api-reference/endpoint/search
- https://docs.tavily.com/documentation/api-reference/endpoint/usage

## 启用条件

默认关闭搜索，只有服务器配置专用密钥并启用开关后，界面才能提交任务。服务可用状态以工作台显示及服务商实际免费余额为准。此功能不自动升级任何订阅或额度。
