// Optional Gmail read synchronization. Never called for send-only accounts.
// Ordinary bodies require a permitted CRM reference first. Strict delivery-status
// MIME is the disclosed exception: the original reference can exist only inside a report.
type SyncOptions = { token: (account: any, timeoutMs: number) => Promise<string>; host: string; sender?: string; budgetMs?: number };
const ok = (r: any) => { if (r.error) throw new Error(r.error.message); return r.data; };
const decode64 = (s: string) => {
  try { const v=s.replace(/-/g, '+').replace(/_/g, '/'); return new TextDecoder().decode(Uint8Array.from(atob(v+'='.repeat((4-v.length%4)%4)), c => c.charCodeAt(0))); } catch { return ''; }
};
const header = (p: any, name: string) => (p?.headers || []).filter((h: any) => h.name?.toLowerCase() === name.toLowerCase()).map((h: any) => h.value).join(' ');
const mailbox = (s: string) => (s.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] || s.match(/[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9.-]+/i)?.[0] || '').trim().toLowerCase();
function parts(payload: any): any[] { return payload ? [payload, ...(payload.parts || []).flatMap(parts)] : []; }
function visibleText(payload: any) {
  const p = parts(payload), plain = p.filter(x => x.mimeType === 'text/plain' && !x.filename).map(x => decode64(x.body?.data || '')).join('\n');
  if (plain) return plain.slice(0, 20000);
  return p.filter(x => x.mimeType === 'text/html' && !x.filename).map(x => decode64(x.body?.data || '')).join('\n')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').slice(0, 20000);
}
export async function inboundWorker(db: any, options: SyncOptions) {
  const deadline = Date.now() + Math.max(6000,Math.min(22000,options.budgetMs || 18000));
  const dbSignal=(cap=2500)=>AbortSignal.timeout(Math.max(100,Math.min(cap,deadline-Date.now())));
  const accounts = ok(await db.rpc('crm_sync_claim', { p_sender: options.sender || null }).abortSignal(dbSignal())) || [];
  let processed = 0, related = 0;
  const escapedHost = options.host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const refRE = new RegExp(`<([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})@${escapedHost}>`, 'gi');
  const refs = (text: string) => [...new Set(Array.from(text.matchAll(refRE), m => m[1].toLowerCase()))].slice(-20);
  const reportType=(value: string,kind: string)=>/\bmultipart\/report\b/i.test(value)&&new RegExp(`\\breport-type\\s*=\\s*"?${kind}(?:"|;|\\s|$)`,'i').test(value);
  for (const a of accounts) {
    const updateState=(patch:any)=>db.from('mail_accounts').update(patch).eq('user_id',a.user_id).eq('read_lease_until',a.read_lease_until).abortSignal(dbSignal());
    // Leave no account leased needlessly when the bounded cron budget is exhausted.
    if (Date.now() > deadline - 2500) { ok(await updateState({ read_lease_until: null })); continue; }
    try {
      const token = await options.token(a,Math.max(300,Math.min(4000,deadline-Date.now())));
      const currentAccount=async()=>{
        const [accountResult,actorResult]=await Promise.all([db.from('mail_accounts').select('read_enabled,connected,email,read_since,read_lease_until').eq('user_id', a.user_id).single().abortSignal(dbSignal()),db.from('profiles').select('active').eq('id',a.user_id).single().abortSignal(dbSignal())]);
        const still=ok(accountResult),actor=ok(actorResult);
        if (!actor.active || !still.read_enabled || !still.connected || still.email!==a.email || still.read_since!==a.read_since || still.read_lease_until!==a.read_lease_until) throw new Error('同步已停用或邮箱授权已变更');
      };
      const get = async (path: string, query: Record<string, string | string[]> = {}) => {
        await currentAccount();
        const left = deadline - Date.now(); if (left < 750) throw new Error('本轮同步时间已用完，稍后继续');
        const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/' + path);
        Object.entries(query).forEach(([k, v]) => (Array.isArray(v) ? v : [v]).forEach(s => url.searchParams.append(k, s)));
        const response = await fetch(url, { redirect:'error',credentials:'omit',headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(Math.min(5000, left)) });
        if (!response.ok) { const e: any = new Error(`Gmail同步返回${response.status}，请检查读取授权或稍后重试`); e.status = response.status; throw e; }
        if (Number(response.headers.get('content-length') || 0) > 3000000) throw new Error('来信过大，未导入；请在Gmail人工查看');
        if(!response.body)throw new Error('Gmail未返回同步内容');
        const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
        try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>3000000)throw new Error('来信过大，未导入；请在Gmail人工查看');chunks.push(p.value);}}finally{await reader.cancel().catch(()=>{});}
        const bytes=new Uint8Array(size);let offset=0;for(const p of chunks){bytes.set(p,offset);offset+=p.length;}return JSON.parse(new TextDecoder().decode(bytes));
      };
      const matchesFor=async(ids:string[],received:number)=>{
        if(!ids.length)return [];
        const candidates=ok(await db.from('mail_messages').select('id,recipient,client_id,sent_at,attempted_at').eq('sender_id',a.user_id).in('id',ids).in('status',['sent','unknown','bounced']).abortSignal(dbSignal()))||[];
        const dated=candidates.filter((m:any)=>{const sent=Date.parse(m.sent_at||m.attempted_at);return Number.isFinite(sent)&&sent<=received+300000;});
        const roots=await Promise.all([...new Set(dated.map((m:any)=>m.client_id))].map(async id=>({original:id,root:ok(await db.rpc('crm_effective_client',{p_client:id}).abortSignal(dbSignal()))})));
        const idsOfRoots=[...new Set(roots.map(r=>r.root).filter(Boolean))];if(!idsOfRoots.length)return [];
        const clients=ok(await db.from('clients').select('id,owner_id').in('id',idsOfRoots).abortSignal(dbSignal()))||[];
        const actor=ok(await db.from('profiles').select('active,role').eq('id',a.user_id).single().abortSignal(dbSignal()));if(!actor.active)throw new Error('账号已停用');
        const allowed=new Set(clients.filter((c:any)=>actor.role==='admin'||c.owner_id===a.user_id).map((c:any)=>c.id));
        return dated.map((m:any)=>({...m,root_id:roots.find(r=>r.original===m.client_id)?.root})).filter((m:any)=>allowed.has(m.root_id));
      };
      const choose=(matches:any[],direct:string[],recipients:string[])=>{
        const primary=matches.filter(m=>direct.includes(m.id)),pool=primary.length?primary:matches;
        const matching=pool.filter(m=>recipients.includes(m.recipient.toLowerCase()));let selected=matching.length?matching:pool;
        if(primary.length&&!matching.length){
          const other=matches.filter(m=>recipients.includes(m.recipient.toLowerCase()));
          if(other.length){
            const roots=new Set([...primary,...other].map(m=>m.root_id));
            if(roots.size!==1)throw new Error('直接回复标头与发件人属于不同公司，无法唯一关联；请到Gmail人工核对');
            selected=other;
          }
        }
        if(!selected.length)return null;
        if(new Set(selected.map(m=>m.root_id)).size!==1)throw new Error('来信引用了多家公司，无法唯一关联；请到Gmail人工核对');
        return selected.sort((x,y)=>Date.parse(y.sent_at||y.attempted_at)-Date.parse(x.sent_at||x.attempted_at))[0];
      };
      const backlog = ok(await db.from('crm_inbound_queue').select('provider_id').eq('sender_id', a.user_id).lt('attempts',4).limit(201).abortSignal(dbSignal()));
      // A slow mailbox is drained before collecting another page, preserving cursors.
      if (backlog.length < 200) {
        if (a.read_seed_since) {
          const page = await get('messages', { q: `after:${Math.floor(new Date(a.read_seed_since).getTime() / 1000)} -in:sent -in:drafts`, maxResults: '50', ...(a.read_seed_page ? { pageToken: a.read_seed_page } : {}) });
          await currentAccount();
          if (page.messages?.length) ok(await db.from('crm_inbound_queue').upsert(page.messages.map((m: any) => ({ sender_id: a.user_id, provider_id: m.id })), { onConflict: 'sender_id,provider_id', ignoreDuplicates: true }).abortSignal(dbSignal()));
          ok(await updateState({ read_seed_page: page.nextPageToken || null, ...(!page.nextPageToken ? { read_seed_since: null } : {}) }));
        } else if (a.read_history_id) {
          try {
            const page = await get('history', { startHistoryId: a.read_history_id, historyTypes: 'messageAdded', maxResults: '50', ...(a.read_history_page ? { pageToken: a.read_history_page } : {}) });
            const ids = [...new Set((page.history || []).flatMap((h: any) => (h.messagesAdded || []).map((x: any) => x.message?.id)).filter(Boolean))];
            await currentAccount();
            if (ids.length) ok(await db.from('crm_inbound_queue').upsert(ids.map(id => ({ sender_id: a.user_id, provider_id: id })), { onConflict: 'sender_id,provider_id', ignoreDuplicates: true }).abortSignal(dbSignal()));
            ok(await updateState({ read_history_page: page.nextPageToken || null, ...(!page.nextPageToken && page.historyId ? { read_history_id: page.historyId } : {}) }));
          } catch (e) {
            if ((e as any).status !== 404) throw e;
            // Google's expired history requires a new bounded scan; expose the gap.
            const profile = await get('profile');
            if(!profile.historyId)throw new Error('Gmail没有返回新的同步起点，请重新授权');
            const since = new Date(Math.max(new Date(a.read_since).getTime(), Date.now() - 7 * 86400000)).toISOString();
            ok(await updateState({ read_history_id: profile.historyId, read_history_page: null, read_seed_since: since, read_seed_page: null, read_gap_at: new Date().toISOString() }));
          }
        } else throw new Error('缺少同步起点，请重新授权读取权限');
      }
      const queue = ok(await db.from('crm_inbound_queue').select('*').eq('sender_id', a.user_id).lt('attempts', 4).order('created_at').limit(4).abortSignal(dbSignal()));
      for (const task of queue) {
        if (Date.now() > deadline - 1500) break;
        try {
          const existing = ok(await db.from('crm_mail_inbound').select('id').eq('sender_id', a.user_id).eq('provider_id', task.provider_id).maybeSingle().abortSignal(dbSignal()));
          if (!existing) {
            const metadata = await get('messages/' + encodeURIComponent(task.provider_id), { format: 'metadata', metadataHeaders: ['From', 'Subject', 'In-Reply-To', 'References', 'Auto-Submitted', 'Precedence', 'Content-Type','Authentication-Results','X-Autoreply','X-Autorespond'] });
            const received = Number(metadata.internalDate), p = metadata.payload;
            if (!metadata.labelIds?.some((label: string) => ['SENT', 'DRAFT'].includes(label)) && Number.isFinite(received) && received >= new Date(a.read_since).getTime()) {
              const from = mailbox(header(p, 'From')),contentType=header(p,'Content-Type'),direct=refs(header(p,'In-Reply-To'));
              const references=[...new Set([...refs(header(p,'References')),...direct])].slice(-20);
              const dsnCandidate=reportType(contentType,'delivery-status');
              let matches=await matchesFor(references,received);
              // A UUID-shaped header alone never justifies reading an ordinary body.
              if(matches.length||dsnCandidate){
                const full=await get('messages/'+encodeURIComponent(task.provider_id),{format:'full'}),all=parts(full.payload);
                const report=dsnCandidate?all.filter(x=>x.mimeType==='message/delivery-status').map(x=>decode64(x.body?.data||'')).join('\n'):'';
                const blocks=report.split(/\r?\n[ \t]*\r?\n/).map((s:string)=>s.replace(/\r?\n[ \t]+/g,' '));
                const recipients=blocks.flatMap((s:string)=>[...s.matchAll(/(?:^|\n)(?:Final|Original)-Recipient:\s*rfc822;\s*([^\s;<>]+@[^\s;<>]+)/gi)].map(m=>m[1].trim().toLowerCase()));
                if(dsnCandidate){
                  const originalHeaders=all.map(x=>header(x,'Message-ID')+' '+header(x,'Original-Message-ID')).join(' ');
                  const originalText=all.filter(x=>['message/delivery-status','message/rfc822','text/rfc822-headers'].includes(x.mimeType)).map(x=>decode64(x.body?.data||'')).join('\n');
                  matches=await matchesFor([...new Set([...references,...refs(originalHeaders+'\n'+originalText)])].slice(-20),received);
                }
                const match=choose(matches,direct,dsnCandidate&&recipients.length?recipients:[from]);
                if(match){
                  const submitted=header(p,'Auto-Submitted').trim().split(/[;\s]/)[0].toLowerCase();
                  const mdn=reportType(contentType,'disposition-notification')||all.some(x=>x.mimeType==='message/disposition-notification');
                  const automatic=!!submitted&&submitted!=='no'||mdn||/\bmultipart\/report\b/i.test(contentType)||/\b(?:bulk|list|junk)\b/i.test(header(p,'Precedence'))||!!header(p,'X-Autoreply')||!!header(p,'X-Autorespond');
                  const authFailed=/\b(?:dmarc|spf|dkim)\s*=\s*(?:fail|softfail|permerror|temperror)\b/i.test(header(p,'Authentication-Results'));
                  let kind=from===match.recipient.toLowerCase()&&!authFailed?(automatic?'auto_reply':'reply'):'review';
                  const recipientEsc=match.recipient.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
                  const recipientBlock=blocks.find((s:string)=>new RegExp(`(?:^|\\n)(?:Final|Original)-Recipient:\\s*rfc822;\\s*${recipientEsc}(?:\\s|$)`,'i').test(s));
                  if(dsnCandidate&&recipientBlock&&!authFailed){
                    if(/(?:^|\n)Action:\s*failed\b/i.test(recipientBlock)&&/(?:^|\n)Status:\s*5\.\d{1,3}\.\d{1,3}\b/i.test(recipientBlock))kind='permanent_bounce';
                    else if(/(?:^|\n)Action:\s*delayed\b/i.test(recipientBlock)&&/(?:^|\n)Status:\s*4\.\d{1,3}\.\d{1,3}\b/i.test(recipientBlock))kind='temporary_bounce';
                    else kind='review';
                  }
                  await currentAccount();
                  ok(await db.rpc('crm_store_inbound',{p_sender:a.user_id,p_provider:task.provider_id,p_outbound:match.id,p_kind:kind,p_received:new Date(received).toISOString(),p_from:from,p_subject:header(full.payload,'Subject'),p_body:(visibleText(full.payload)||report||'（没有可读取的正文，请到Gmail核对）').slice(0,20000)}).abortSignal(dbSignal()));related++;
                }
              }
            }
          }
          ok(await db.from('crm_inbound_queue').delete().eq('sender_id', a.user_id).eq('provider_id', task.provider_id).abortSignal(dbSignal())); processed++;
        } catch (e) {
          if ((e as any).status === 404) { ok(await db.from('crm_inbound_queue').delete().eq('sender_id', a.user_id).eq('provider_id', task.provider_id).abortSignal(dbSignal())); continue; }
          ok(await db.from('crm_inbound_queue').update({ attempts: task.attempts + 1, error: '读取或关联失败；请人工检查Gmail，可在邮件中心重新排队' }).eq('sender_id', a.user_id).eq('provider_id', task.provider_id).abortSignal(dbSignal()));
          if (Date.now() > deadline - 1500) break;
        }
      }
      const failed = ok(await db.from('crm_inbound_queue').select('provider_id').eq('sender_id', a.user_id).gte('attempts', 4).limit(1).abortSignal(dbSignal()));
      ok(await updateState({ read_last_sync_at: new Date().toISOString(), read_error: failed.length ? '有来信同步失败待人工核对，可点击重试失败项' : null }));
    } catch (e) {
      ok(await updateState({ read_error: String((e as Error).message).slice(0, 160) }));
    } finally {
      ok(await updateState({ read_lease_until: null }));
    }
  }
  return { processed, related };
}
