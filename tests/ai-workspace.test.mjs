import test from 'node:test';
import assert from 'node:assert/strict';
import {qualificationScore,eligibleProviders,reservationSize,validateResult,selectSources,fallbackAllowed,qwenEndpoint,ensurePublicOnly} from '../supabase/functions/crm-agent/logic.mjs';
const now=Date.parse('2026-10-27T00:00:00Z');
test('free fallback never routes private mail to Gemini or expired/unprotected providers',()=>{
 const base={enabled:true,free_only_verified:true,expires_at:'2026-12-01',model:'qwen-plus',priority:1};
 const providers=[{...base,id:'qwen',private_allowed:true},{...base,id:'gemini',private_allowed:false,priority:2},{...base,id:'old',expires_at:'2025-01-01'},{...base,id:'paid',free_only_verified:false}];
 assert.deepEqual(eligibleProviders(providers,'reply','gemini',{qwen:true,gemini:true,old:true,paid:true},now).map(p=>p.id),['qwen']);
 assert.deepEqual(eligibleProviders(providers,'knowledge','gemini',{qwen:true,gemini:true},now).map(p=>p.id),['gemini','qwen']);
 assert.equal(eligibleProviders(providers,'reply','qwen',{qwen:false,gemini:true},now).length,0);
});
test('unknown, future, stale and negative qualification claims do not increase score',()=>{
 const fact={state:'confirmed',value:'有仓库',source:'https://example.com/about',date:'2026-10-20'};
 assert.equal(qualificationScore({warehouse:fact},now).score,20);
 for(const patch of [{state:'pending'},{source:''},{date:'2024-01-01'},{date:'2027-01-01'},{value:'没有仓库'}])assert.equal(qualificationScore({warehouse:{...fact,...patch}},now).score,0);
});
test('model cannot invent source links or inject a mail subject header',()=>{
 const source={id:'K1',text:'公司资料',title:'test'};
 const r=validateResult(JSON.stringify({answer:'答案',source_ids:['madeup','K1','K1']}),[source],'knowledge');
 assert.deepEqual(r.sources,[source]);
 assert.throws(()=>validateResult(JSON.stringify({answer:'分析',subject:'Subject\r\nBcc: someone',body:'text'}),[],'reply'));
 assert.throws(()=>validateResult('not json',[],'knowledge'));
 assert.match(validateResult('{"answer":"可能有仓库"}',[],'research').answer,/依据不足/);
});
test('source selection and reservation keep Chinese context within hard request bounds',()=>{
 const selected=selectSources('SPC',[{id:'a',title:'a',text:'a'.repeat(9000)},{id:'b',title:'SPC',text:'产'.repeat(9000)}],5000);
 assert.equal(selected[0].id,'b');assert.equal(selected.reduce((n,s)=>n+s.text.length,0),5000);
 assert.equal(reservationSize('中','文',1600),2118);
 assert.equal(fallbackAllowed(401),false);assert.equal(fallbackAllowed(429),true);
});

test('confidential workspaces are blocked before context retrieval or model submission',()=>{
 for(const task of ['reply','research','daily','business'])assert.throws(()=>ensurePublicOnly({task}));
 assert.throws(()=>ensurePublicOnly({task:'knowledge',client_id:'real-customer'}));
 assert.throws(()=>ensurePublicOnly({task:'training',inbound_id:'real-email'}));
 assert.doesNotThrow(()=>ensurePublicOnly({task:'training'}));
});
test('model destination stays on the approved Alibaba workspace, without credentials or redirects',()=>{
 assert.equal(qwenEndpoint('https://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'),'https://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
 for(const url of ['http://dashscope.aliyuncs.com/compatible-mode/v1','https://evil.example/compatible-mode/v1','https://user:pass@dashscope.aliyuncs.com/compatible-mode/v1','https://dashscope.aliyuncs.com/compatible-mode/v1?x=y'])assert.throws(()=>qwenEndpoint(url));
});
