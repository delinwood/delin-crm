// Exercises the real HTTP handler and tool protocol with an in-memory service stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {compileFunction} from 'node:vm';
import * as logic from '../supabase/functions/crm-agent/logic.mjs';
import * as tools from '../supabase/functions/crm-agent/chat-tools.ts';
const user='10000000-0000-4000-8000-000000000001',customer='20000000-0000-4000-8000-000000000001';
test('general chat executes real server tool, continues with native tool messages, and drops outputs on changed access',async()=>{
 const saved=new Map(),modelCalls=[];let handler,access=true,nextTool=true;
 const settings={enabled:true,private_consent:true};
 const person={id:user,role:'sales',active:true};
 const provider={id:'qwen',enabled:true,free_only_verified:true,private_allowed:true,expires_at:'2099-01-01',model:'qwen-plus',priority:1};
 function builder(name){
  const filters=[],state={patch:null,single:false};
  const q=new Proxy({}, {get(_t,key){
   if(key==='then')return(resolve)=>{
    let rows=name==='profiles'?[person]:name==='crm_ai_settings'?[settings]:name==='crm_ai_providers'?[provider]:name==='clients'?[{id:customer,company_name:'Buyer',owner_id:user}]:name==='crm_ai_requests'?[...saved.values()]:[];
    for(const [op,col,val]of filters)rows=rows.filter(r=>op==='in'?val.includes(r[col]):r[col]===val);
    if(state.patch)for(const r of rows)Object.assign(r,state.patch);
    return Promise.resolve(resolve({data:state.single?rows[0]||null:rows,count:rows.length}));
   };
   return(...args)=>{if(['eq','in'].includes(key))filters.push([key,...args]);if(key==='update')state.patch=args[0];if(['single','maybeSingle'].includes(key))state.single=true;return q;};
  }});return q;
 }
 const client={auth:{getUser:async()=>({data:{user:{id:user}}})},from:builder,rpc:async(name,args)=>{
  if(name==='crm_ai_can_access_clients')return{data:access};
  if(name==='crm_ai_reserve'){saved.set(args.p_id,{id:args.p_id,user_id:user,task:args.p_task,status:'reserved',question:args.p_question,created_at:new Date().toISOString()});return{data:args.p_id};}
  return{data:true};
 }};
 const env={SUPABASE_URL:'https://project.example.test',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'test-service',QWEN_API_KEY:'test-only',CRM_SITE_URL:'https://crm.example.test/'};
 const fakeFetch=async(_url,opts)=>{
  const body=JSON.parse(opts.body);modelCalls.push(body);
  return new Response(JSON.stringify({choices:[{message:nextTool?{content:'',tool_calls:[{id:'call_test',type:'function',function:{name:'find_clients',arguments:'{"query":"Buyer"}'}}]}:{content:'我找到了CRM中的Buyer；这是现有客户，不是新搜索结果。'}}],usage:{total_tokens:100}}),{status:200});
 };
 const source=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/crm-agent/index.ts',import.meta.url),'utf8')).replace(/^import .*$/gm,'');
 const names=['createClient','Deno','fetch',...Object.keys(logic),...Object.keys(tools)];
 compileFunction(source,names)(()=>client,{env:{get:k=>env[k]},serve:fn=>handler=fn},fakeFetch,...Object.values(logic),...Object.values(tools));
 const run=async data=>{const response=await handler(new Request('https://project.example.test/functions/v1/crm-agent',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json',Origin:'https://crm.example.test'},body:JSON.stringify({action:'run',task:'chat',consent:true,request_id:crypto.randomUUID(),...data})}));return{status:response.status,data:await response.json()};};
 const first=await run({question:'查找Buyer'});assert.equal(first.status,200);assert.equal(first.data.result.needs_continue,true);assert.equal(first.data.result.tools[0].status,'completed');
 assert.ok(saved.get(first.data.id).related_client_ids.includes(customer));
 nextTool=false;
 const final=await run({question:'继续',history_ids:[first.data.id],continue_tools:false});assert.equal(final.status,200);assert.match(final.data.result.answer,/Buyer/);
 assert.equal(modelCalls[1].tool_choice,'none');assert.ok(modelCalls[1].messages.some(m=>m.role==='tool'&&m.tool_call_id==='call_test'&&m.content.includes('Buyer')));
 assert.equal(modelCalls[0].response_format,undefined,'tool calls use native protocol, not forced JSON replies');
 access=false;
 const blocked=await run({question:'继续',history_ids:[first.data.id]});assert.equal(blocked.status,400);assert.match(blocked.data.error,/权限/);assert.ok([...saved.values()].some(r=>r.status==='failed'));
});
