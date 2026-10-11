// ===== 部署配置 Deployment config =====
// MODE: 'demo'  -> 本地演示（数据存于浏览器 localStorage，含示例客户）
//       'supabase' -> 正式模式（Supabase 登录 + Postgres + 行级权限 RLS）
window.CRM_CONFIG = {
  MODE: 'supabase',
  COMPANY_NAME_EN: 'DELIN WOOD INDUSTRY (SHANDONG) CO., LTD.',   // TODO: 公司英文名
  COMPANY_NAME_CN: '德林木业 外贸部',               // TODO: 公司中文名
  COMPANY_WEBSITE: 'https://www.delinfloor.com',                           // TODO: 官网，用于开发信签名 {{my_website}}
  LOGO_URL: 'assets/logo.png',                                  // TODO: e.g. 'assets/logo.png'
  SUPABASE_URL: 'https://bccatmfiaawocpgagzzf.supabase.co',                              // e.g. 'https://xxxx.supabase.co'
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjY2F0bWZpYWF3b2NwZ2FnenpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2OTc1ODcsImV4cCI6MjEwNzI3MzU4N30.3CiNiM7m4vi0t2agehTzXTO4WHUZkyIxQYI7FC-jCbI',                         // public anon key (safe in frontend; RLS protects data)
  USERNAME_EMAIL_DOMAIN: 'delinfloor.com'       // 用户名 -> 登录邮箱 映射: sales1 -> sales1@crm.example.com
};
// Boss account email: delinwood666@gmail.com
