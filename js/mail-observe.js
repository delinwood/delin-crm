/* Readable bounce lines and a manual send-pace summary. No open or click tracking. */
(function (root) {
  function field(text, name) {
    const match = String(text || '').match(new RegExp('(?:^|\\n)\\s*' + name + ':\\s*([^\\n]{1,220})', 'i'));
    return match ? match[1].trim() : '';
  }
  function bounceSummary(text) {
    const source = String(text || '');
    const recipient = (source.match(/(?:Final|Original)-Recipient:\s*rfc822;\s*([^\s;<>]+@[^\s;<>]+)/i) || [])[1] || '';
    const status = (field(source, 'Status').match(/[45]\.\d{1,3}\.\d{1,3}/) || [])[0] || '';
    const action = (field(source, 'Action').match(/failed|delayed|delivered|relayed|expanded/i) || [])[0] || '';
    const diagnostic = field(source, 'Diagnostic-Code').replace(/^smtp;\s*/i, '').slice(0, 160);
    const reason = [action && action.toLowerCase(), status, diagnostic].filter(Boolean).join(' · ');
    return { recipient: recipient.toLowerCase(), reason };
  }
  function dayKey(iso, timeZone) {
    const time = Date.parse(iso || '');
    if (!Number.isFinite(time)) return '';
    return new Date(time).toLocaleDateString('sv-SE', { timeZone: timeZone || 'Asia/Shanghai' });
  }
  function paceDays(messages, days, now) {
    const count = Math.max(1, Math.min(31, Number(days) || 7));
    const end = now instanceof Date ? now : new Date();
    const rows = [];
    for (let i = count - 1; i >= 0; i--) {
      const date = new Date(end.getTime() - i * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
      const matched = (messages || []).filter(m => dayKey(m.attempted_at) === date);
      rows.push({
        date,
        attempts: matched.length,
        accepted: matched.filter(m => m.status === 'sent' || m.status === 'bounced').length,
        failed: matched.filter(m => m.status === 'failed' || m.status === 'unknown').length
      });
    }
    return rows;
  }
  root.CRM_OBSERVE = { bounceSummary, paceDays, dayKey };
})(typeof window !== 'undefined' ? window : globalThis);
