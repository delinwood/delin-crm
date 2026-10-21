# Gmail 邮件中心部署

## 2026-10-21 限额与自动发信更新

迁移：`supabase/migrations/20261021010000_mail_limits_and_plans.sql`。先执行迁移，再部署后端与前端。现有限额会原样保留；新账号默认50；0表示不设CRM过去24小时上限，Google限发和每分钟1封仍保留。老板可为尚未连接Gmail的账号预存额度，重新授权不会重置额度。保存API返回真实值，前端按所选账号回填；旧版写死50的输入框已修复。

计划支持：首次现在/延后0–365天/指定本机日期时间；仅一次或上封成功后满3/7天继续；默认共3轮，可设1–100轮或持续直到停止。每位客户首封与两封交替跟进正文在确认前预览。计划未确认不创建，单批最多400客户。纯规则个性化不调用收费AI，使用结构化公司、姓名、产品、地区，不从备注编造。

计划和发信均在服务器持久化；每分钟调度。跨日额度不会使计划丢失。每位客户最多一封未完成邮件；失败/不明状态暂停，不自动补发。退订、退信、无效、删除、已回复/成交、归属变化会停止后续；公司/姓名/产品等资料变化会暂停并要求重新预览。系统不读取收件箱，客户回复后业务员需标记“已回复”或点击“停止 / 已回复”。暂停/取消无法撤回已经提交Gmail的请求。

本地验证：`tests/mail.test.mjs`；SQL执行验证使用 `tests/mail-plans-db.test.mjs`，依赖 `@electric-sql/pglite` 安装在 `deploy/qa`（仅本地开发依赖，不发布）。覆盖迁移、限额/无上限、预存偏好、未来时间、幂等、租约、重复保护、轮数/间隔、停止、资料改变与回复、权限隔离；不会发送真实邮件。

Google授权应用已于2026-10-19切换Production并重新授权；这不代表完整审核通过。公司官网介绍/隐私/条款已发布在 www.ddllwood.com，域名Search Console所有权已验证。未开通付费服务。

## 已实现的代码

客户详情单封发送，客户列表批量发送（1–400封/任务），发送前全部预览，模板变量或按结构化属性生成内容。产品不明时询问品类，不从备注编造客户事实。业务员只可发送自己的客户，管理员可发送和查看全队。每封独立发送并带退订链接。发送成功后计入当天统计并显示在客户跟进时间线，自己的客户重新开始三天提醒计时。

每邮箱默认滚动24小时50次尝试，管理员可调1–400；每分钟最多1封。一次400封任务可以分多天完成。系统上限并非Google可用额度：网页和手机发出的邮件不会计入CRM。API接受只证明Gmail接受邮件，不证明送达/进入收件箱。

队列持久化；刷新/关网页不丢任务。支持暂停、继续、取消待发送、CSV导出、确认退信/停止联系。自动排除无效/已退订邮箱、重复邮箱、24小时内已发送或状态不明客户。超时状态为“待核实”，不自动重试，防止重复发送。管理员也不能查看OAuth令牌。

只申请openid、email和gmail.send。不会读取回复或自动识别退信；业务员收到退信后在记录中标记。不要把这一版宣传为自动回复追踪或自动退信检测。邮件模板规则生成不消耗AI API，但不包含AI自由撰写或未经确认的产品事实。

## Google配置

Google项目：Delin CRM Mail（spherical-proxy-512010-c0）。此项目已在2026-10-18创建；后续配置状态以控制台为准。

1. Google Auth Platform配置外部应用；测试模式先添加delinwood666@gmail.com。
2. API Library启用Gmail API。
3. 添加openid、email、https://www.googleapis.com/auth/gmail.send。
4. 创建Web OAuth客户端，重定向URI必须完全匹配：
   https://bccatmfiaawocpgagzzf.supabase.co/functions/v1/crm-mail?route=callback
5. 客户端机密只存Supabase Edge Function Secrets。不得公开在代码、网页、截图、GitHub。
6. 外部测试模式下，使用Gmail权限的刷新令牌通常7天失效，需要重新授权。正式长期使用须处理OAuth验证、域名、隐私政策等要求；GitHub Pages共享域名不是自有域名的替代品。

## Supabase部署

先对照正式profiles/clients表及is_admin/is_active_user辅助函数，执行supabase/migrations/20261018020000_mail_campaigns.sql。此迁移创建独立表，不删除客户。

配置Edge Function Secrets：

- CRM_SITE_URL=https://delinwood.github.io/delin-crm
- GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET：从Google客户端取得
- MAIL_TOKEN_KEY：随机32字节，base64编码，用于AES-GCM加密刷新令牌
- MAIL_UNSUBSCRIBE_KEY：至少32字节随机密钥，部署后保留，轮换需保留旧链接兼容性
- MAIL_WORKER_SECRET：至少32字节随机密钥
- SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY：平台内置，只在服务器使用

部署命令：supabase functions deploy crm-mail --no-verify-jwt --project-ref bccatmfiaawocpgagzzf

verify_jwt=false是为Google回调/退订路由开放HTTP入口。普通操作在代码中通过auth.getUser验证JWT、profile.active及归属；worker单独验证MAIL_WORKER_SECRET。

将MAIL_WORKER_SECRET同值保存在Supabase Vault，名称crm_mail_worker_secret；执行supabase/mail-cron.sql一次。重复运行前先查cron.job同名任务，避免重复计划。每分钟worker最多处理3个不同邮箱，各一个任务。

发布前端index.html、js/mail-merge.js、js/v_mail.js、js/core.js、js/v_clients.js、css/style.css，保留其他已发布文件。没有部署后端时，邮件中心明确显示服务未配置且不发送。

## 验证范围和上线门槛

本地运行tests/mail.test.mjs，仅模拟数据库和Google接口，不发送真实邮件。必须继续在隔离数据库验证SQL权限和并发、再用本人控制的收件邮箱完成OAuth/真实投递联调。实际发送需用户给出测试收件人和授权，不使用真实客户做测试。

必须检查：匿名/停用/越权调用被拒、员工不能读他人邮件或任何令牌、公海对员工禁止发送、并发提交同任务不重复、邮箱去重、400上限、24小时计数与跨日、失效令牌暂停、断开连接暂停、超时不重试、退订后不再发送、发送成功后时间线与三天提醒。服务器成功与数据库提交间断网时应保留unknown，不自动补发。

后台只统计系统发送。当天显示按浏览器本地时区，滚动额度固定过去24小时。人工确认退信保留sent_at，因此当天发出数不会因退信而被抹去。
