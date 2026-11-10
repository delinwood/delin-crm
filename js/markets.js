/* Target markets: China customs export rankings.
   window.MARKETS stays the overall board so prospecting, discovery, and CRM
   country matching keep using each record's English `country` key. */
(function () {
  const profiles = window.MARKET_PROFILES || [];
  const lists = window.MARKET_PRODUCT_LISTS || {};
  const flooring = window.MARKET_FLOORING_EX_EU || [];
  const byCn = Object.create(null);
  profiles.forEach(p => { byCn[p.cn] = p; });

  function formatNum(n, digits) {
    const neg = n < 0;
    const parts = Math.abs(n).toFixed(digits).split('.');
    const grouped = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + grouped + (parts[1] ? '.' + parts[1] : '');
  }

  function wan(kg) {
    if (kg == null || !Number.isFinite(Number(kg))) return '—';
    const v = Number(kg) / 1e7;
    if (v === 0) return '0';
    const abs = Math.abs(v);
    const digits = abs >= 0.01 ? 2 : abs >= 0.0001 ? 4 : 6;
    return formatNum(v, digits);
  }

  function ton(delta) {
    if (delta == null || !Number.isFinite(Number(delta))) return '—';
    const t = Number(delta) / 1000;
    if (t === 0) return '0';
    const digits = Math.abs(t) >= 100 ? 0 : 1;
    return (t > 0 ? '+' : '') + formatNum(t, digits);
  }

  function growth(g, q26) {
    if (g == null || !Number.isFinite(Number(g))) {
      const none = q26 == null || Number(q26) === 0;
      return { text: none ? '2026年暂无' : '新市场', kind: 'new' };
    }
    const pct = Number(g) * 100;
    const body = formatNum(Math.abs(pct), 1) + '%';
    return { text: pct > 0 ? '+' + body : pct < 0 ? '-' + body : body, kind: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
  }

  window.MARKET_TEXT = { wan, ton, growth };

  function present(profile, stats) {
    return {
      rank: stats.rank,
      q25: stats.q25 == null ? null : stats.q25,
      q26: stats.q26,
      growth: stats.growth,
      delta: stats.delta,
      country: profile.country,
      cn: profile.cn,
      lang: profile.lang,
      fairs: profile.fairs,
      certs: profile.certs,
      best: profile.best,
      intro: profile.intro,
      sources: profile.sources || [],
      products: profile.products
    };
  }

  function presentList(list) {
    return (list || []).map(row => {
      const profile = byCn[row.cn];
      if (!profile) {
        console.error('市场介绍缺少国家：', row.cn);
        return null;
      }
      return present(profile, row);
    }).filter(Boolean);
  }

  const avoid = '已排除美国、加拿大和欧盟 27 国，以及这些市场在本数据中的海外省/属地。美国、加拿大和欧盟仍留在综合榜和墙板榜。';
  window.MARKETS = profiles;
  window.MARKETS_SOURCE = '中国海关出口统计，HS 44111319 强化复合地板、44123300 实木复合地板、39181090 SPC/PVC 地板、39259000 墙板（PVC格栅/UV/共挤已按税号去重）；2025 为 1–10 月，2026 为 1–9 月，增速和增量均按月均比较。综合排名以体量为主、增速作有限加权；综合榜前 100 名锁定后按该规则重排，101 名之后同样规则接上。';
  window.MARKET_BOARDS = [
    { id: 'overall', label: '综合榜', metric: '综合出口', highlight: [], scope: '全球市场，包含美国、加拿大、欧盟，以及体量很小的市场。排名以出口体量为主、月均增速作有限加权。', rows: profiles.map(p => present(p, p)) },
    { id: 'laminate', label: '强化复合地板', metric: '强化复合地板', highlight: ['laminate'], scope: '仅强化复合地板（HS 44111319）。' + avoid, rows: presentList(lists.laminate_ex_eu) },
    { id: 'engineered', label: '实木复合地板', metric: '实木复合地板', highlight: ['engineered'], scope: '仅实木复合地板（HS 44123300）。' + avoid, rows: presentList(lists.engineered_ex_eu) },
    { id: 'spc', label: 'SPC地板', metric: 'SPC地板', highlight: ['spc'], scope: '仅 SPC/PVC 地板（HS 39181090）。' + avoid, rows: presentList(lists.spc_ex_eu) },
    { id: 'wall', label: '墙板', metric: '墙板', highlight: ['wall'], scope: '墙板（HS 39259000，PVC格栅/UV/共挤已按税号去重）。全球统计，包含美国、加拿大和欧盟。', rows: presentList(lists.wall) },
    { id: 'flooring', label: '地板（避开美加欧）', metric: '三类地板合计', highlight: ['laminate', 'engineered', 'spc'], scope: '强化、实木复合、SPC 三类地板合计。' + avoid, rows: presentList(flooring) }
  ];
})();
