import test from 'node:test';
import assert from 'node:assert/strict';
import {executeChatTool,chatTools} from '../supabase/functions/crm-agent/chat-tools.ts';
import {ensureTaskScope,eligibleProviders,validateResult} from '../supabase/functions/crm-agent/logic.mjs';
const clientId='12345678-1234-4123-8123-123456789abc';
function fixture(rows=[]){
 const calls=[];
 const builder=new Proxy({}, {get(_t,key){if(key==='then')return resolve=>Promise.resolve(resolve({data:rows,count:rows.length}));return(...args)=>{calls.push([key,...args]);return builder;};}});
 return {calls,client:{from:name=>{calls.push(['from',name]);return builder;},rpc:async(name,args)=>{calls.push(['rpc',name,args]);return{data:{id:clientId,title:args.p_data?.title,next_at:args.p_data?.start_at,frequency:'once',every_n:1}};}},me:{id:'employee',role:'sales'},ck:r=>{if(r.error)throw r.error;return r.data;},company:async(_client,_me,id)=>{if(id!==clientId)throw new Error('客户归属已变化');return{id,company_name:'Sample'};},knowledge:async()=>[],context:async(_input,_client,me)=>{if(me.role!=='admin')throw new Error('仅老板可查看经营问答');return{payload:{}};},uid:/^[0-9a-f-]{36}$/i,request_id:'turn-1'};
}
test('chat permits general questions without a populated knowledge base, using approved private model only',()=>{
 assert.doesNotThrow(()=>ensureTaskScope({task:'chat',consent:true},{private_consent:true}));
 assert.throws(()=>ensureTaskScope({task:'chat',consent:true},{private_consent:false}));
 const p={enabled:true,free_only_verified:true,expires_at:'2099-01-01',model:'x',priority:1};
 assert.deepEqual(eligibleProviders([{...p,id:'qwen',private_allowed:true},{...p,id:'gemini',private_allowed:true}],'chat','gemini',{qwen:true,gemini:true}).map(x=>x.id),['qwen']);
 assert.equal(validateResult('{"answer":"你好"}',[],'chat').answer,'你好');
});
test('customer search enforces ownership for staff and reports bounded coverage',async()=>{
 const f=fixture([{id:clientId,company_name:'Sample'}]);
 const r=await executeChatTool('find_clients',{query:'100%_test',country:'Saudi Arabia'},f);
 assert.ok(f.calls.some(c=>c[0]==='eq'&&c[1]==='owner_id'&&c[2]==='employee'));
 assert.ok(f.calls.some(c=>c[0]==='ilike'&&c[2]==='%100test%'));
 assert.deepEqual(r.refs,[clientId]);assert.equal(r.data.total,1);
});
test('unknown tools and other employees customers never reach a write or data query',async()=>{
 const f=fixture();
 await assert.rejects(executeChatTool('delete_all_clients',{},f));
 await assert.rejects(executeChatTool('client_records',{client_id:'other'},f),/归属/);
 await assert.rejects(executeChatTool('business_summary',{},f),/老板/);
 assert.equal(f.calls.length,0);
 assert.ok(!chatTools.some(t=>/delete|send_mail/.test(t.function.name)));
});
test('reminders require timezone; repeated identical tools share a durable nonce',async()=>{
 const f=fixture(),args={title:'装车',start_at:'2026-10-29T15:00:00+08:00',frequency:'once',every_n:1};
 await assert.rejects(executeChatTool('create_reminder',{...args,start_at:'2026-10-29T15:00:00'},f));
 assert.equal(f.calls.length,0);
 const first=await executeChatTool('create_reminder',args,f);
 await executeChatTool('create_reminder',{every_n:1,frequency:'once',start_at:args.start_at,title:'装车'},f);
 const calls=f.calls.filter(c=>c[0]==='rpc');assert.equal(calls[0][1],'crm_ai_create_reminder');assert.equal(calls[0][2].p_nonce,calls[1][2].p_nonce);assert.equal(first.data.saved,true);
});
test('mail drafts never send and cannot access another owners client',async()=>{
 const f=fixture();await assert.rejects(executeChatTool('draft_email',{client_id:'other',subject:'s',body:'b'},f));
 const r=await executeChatTool('draft_email',{client_id:clientId,subject:'Specs',body:'Hello'},f);
 assert.equal(r.data.sent,false);assert.equal(r.action.kind,'mail_draft');assert.equal(f.calls.length,0);
 await assert.rejects(executeChatTool('draft_email',{client_id:clientId,subject:'X\r\nBcc:a@b.com',body:'Hello'},f));
});
test('only latest linked real reply is read, with bounded body and tracked client permission',async()=>{
 const f=fixture([{id:clientId,subject:'Reply',body:'x'.repeat(9000),received_at:'2026-10-28'}]);
 const r=await executeChatTool('client_reply',{client_id:clientId},f);
 assert.equal(r.data.email.body.length,5000);assert.deepEqual(r.refs,[clientId]);
 assert.ok(f.calls.some(c=>c[0]==='eq'&&c[1]==='client_id'&&c[2]===clientId));
 assert.ok(f.calls.some(c=>c[0]==='eq'&&c[1]==='kind'&&c[2]==='reply'));
 assert.ok(f.calls.some(c=>c[0]==='limit'&&c[1]===1));
});
