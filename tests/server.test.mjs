import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {createAppServer} from '../server.mjs';
import {createConfiguredProvider} from '../src/provider.mjs';
import {createDemoProject} from '../src/demo.mjs';
import {encodeProject,decodeProject} from '../src/project.mjs';
import {proposeProgram} from '../src/score.mjs';
// All provider responses below are injected fixtures. No real upstream call is made.
const project=createDemoProject();let documentPromise;
const document=()=>documentPromise??=encodeProject(project),KEY='test-only-not-a-real-key',enabled={THREADSCORE_ENABLE_MODEL:'1',NEBIUS_API_KEY:KEY};
const good=()=>({version:1,expectedRevision:project.revision,ops:[{op:'setRelation',relationId:'answer-exchange',patch:{params:{interval:4}}}]});
const bad=()=>({version:1,expectedRevision:project.revision,ops:[{op:'setRelation',relationId:'invert-mirror',patch:{params:{axis:96}}}]});
function response(program,{status=200,raw}={}){return new Response(raw??JSON.stringify({id:'fake-request-1',model:'nvidia/test-received-model',choices:[{message:{content:typeof program==='string'?program:JSON.stringify(program)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}}),{status,headers:{'Content-Type':'application/json','x-request-id':'fake-request-1'}});}
const configured=(fetchImpl,extra={})=>createConfiguredProvider({env:enabled,fetchImpl,...extra});
async function withServer(provider,run,options={}){const server=createAppServer({provider,...options});await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});const base='http://127.0.0.1:'+server.address().port;try{return await run(base);}finally{server.closeAllConnections();await new Promise(done=>server.close(done));}}
async function post(base,changes={},headers={}){return fetch(base+'/api/program',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...headers},body:JSON.stringify({document:await document(),instruction:'Set the answer transposition to four semitones, preserving pins, preserving pins.',...changes})});}
function observeAttempts(provider,observed){return {...provider,propose(args){return provider.propose({...args,onAttempt(a){observed.push(structuredClone(a));args.onAttempt?.(a);}});}};}
test('model requires explicit opt-in and maintained credential; disabled application stays usable',async()=>{
 let calls=0;const injected=async()=>{calls++;return response(good());};for(const env of [{},{NEBIUS_API_KEY:KEY},{THREADSCORE_ENABLE_MODEL:'1'}])assert.equal(createConfiguredProvider({env,fetchImpl:injected}).available,false);
 await withServer(null,async base=>{const c=await(await fetch(base+'/api/capabilities')).json();assert.equal(c.available,false);assert.equal(typeof c.reason,'string');assert.equal((await post(base)).status,503);});assert.equal(calls,0);
});
test('static whitelist serves the application and excludes secrets/server/provider source',async()=>{
 await withServer(null,async base=>{const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);assert.match(page.headers.get('cache-control'),/no-store/);
 for(const path of ['/server.mjs','/src/provider.mjs','/.env','/%2e%2e/server.mjs'])assert.equal((await fetch(base+path)).status,404);
 for(const path of ['/playback.mjs','/src/import.mjs'])assert.equal((await fetch(base+path)).status,200);});
});
test('valid mocked program compiles and retains bounded actual fixture response receipts',async()=>{
 const requests=[],provider=configured(async(url,options)=>{requests.push({url,options});return response(good());}),before=JSON.stringify(project);
 await withServer(provider,async base=>{const r=await post(base);assert.equal(r.status,200);const v=await r.json();assert.equal(proposeProgram(project,v.program).ok,true);assert.equal(v.attempts.length,1);assert.equal(v.attempts[0].validation,'accepted');assert.equal(v.evidence.receivedModel,'nvidia/test-received-model');assert.equal(v.evidence.requestId,'fake-request-1');assert.deepEqual(v.evidence.usage,{prompt_tokens:100,completion_tokens:50,total_tokens:150});assert.equal(v.evidence.audioSent,false);assert.equal(v.evidence.evidenceOrigin,'live_receipt_this_session');assert.equal(v.evidence.cost,null);assert.equal(JSON.stringify(v).includes(KEY),false);});
 assert.equal(requests.length,1);assert.equal(requests[0].url,'https://api.tokenfactory.nebius.com/v1/chat/completions');assert.equal(requests[0].options.redirect,'error');const payload=JSON.parse(requests[0].options.body);assert.equal(payload.max_tokens,2048);assert.equal(payload.stream,false);assert.equal(requests[0].options.body.includes(KEY),false);assert.equal(JSON.stringify(project),before);
});
test('confirmed invalid program receives exactly one compiler-guided repair',async()=>{
 const requests=[],provider=configured(async(_,o)=>{requests.push(JSON.parse(o.body));return response(requests.length===1?bad():good());});
 await withServer(provider,async base=>{const r=await post(base);assert.equal(r.status,200);assert.deepEqual((await r.json()).attempts.map(a=>a.validation),['rejected','accepted']);});assert.equal(requests.length,2);assert.match(requests[1].messages.at(-1).content,/compiler rejected/i);assert.match(requests[1].messages.at(-1).content,/final permitted repair/i);
});
test('two invalid confirmed programs stop with both receipts at the repair cap',async()=>{
 let calls=0;await withServer(configured(async()=>{calls++;return response(bad());}),async base=>{const r=await post(base);assert.equal(r.status,422);const v=await r.json();assert.match(v.error,/repair limit|valid composition program/i);assert.equal(v.attempts.length,2);assert.ok(v.attempts.every(a=>a.validation==='rejected'));assert.equal(JSON.stringify(v).includes(KEY),false);});assert.equal(calls,2);
});
test('unknown transport is never retried or exposed verbatim',async()=>{
 let calls=0;await withServer(configured(async()=>{calls++;throw Error('Simulated secret '+KEY);}),async base=>{const r=await post(base);assert.equal(r.status,502);const text=await r.text();assert.match(text,/unknown|failed/i);assert.equal(text.includes(KEY),false);});assert.equal(calls,1);
});
test('HTTP failures, oversized bodies and malformed provider envelopes are not retried',async()=>{
 for(const factory of [()=>response(null,{status:500,raw:'secret '+KEY}),()=>new Response('x'.repeat(70000),{headers:{'Content-Length':'70000'}}),()=>response(null,{raw:'{invalid'})]){
  let calls=0;await withServer(configured(async()=>{calls++;return factory();}),async base=>{const r=await post(base);assert.equal(r.status,502);assert.equal((await r.text()).includes(KEY),false);});assert.equal(calls,1);
 }
});
test('a stale revision program cannot be accepted',async()=>{
 let calls=0;const stale=good();stale.expectedRevision--;await withServer(configured(async()=>{calls++;return response(stale);}),async base=>assert.equal((await post(base)).status,422));assert.equal(calls,2);
});
test('corruption and client endpoint/model/key overrides reject before provider dispatch',async()=>{
 let calls=0;await withServer(configured(async()=>{calls++;return response(good());}),async base=>{const corrupt=structuredClone(await document());corrupt.project.revision++;assert.equal((await post(base,{document:corrupt})).status,422);for(const change of [{endpoint:'https://attacker.invalid/'},{model:'unapproved'},{apiKey:'unapproved'},{instruction:'x'.repeat(2001)}])assert.equal((await post(base,change)).status,400);});assert.equal(calls,0);
});
test('foreign origins and actual Host headers reject before dispatch',async()=>{
 let calls=0;await withServer(configured(async()=>{calls++;return response(good());}),async base=>{
  assert.equal((await post(base,{}, {Origin:'https://attacker.invalid'})).status,403);
  const status=await new Promise((done,fail)=>{const req=httpRequest(new URL(base+'/api/capabilities'),{headers:{Host:'attacker.invalid'}},res=>{res.resume();res.on('end',()=>done(res.statusCode));});req.on('error',fail);req.end();});assert.equal(status,403);
 });assert.equal(calls,0);
});
test('request body limit applies before decoding or dispatch',async()=>{
 let calls=0;await withServer(configured(async()=>{calls++;return response(good());}),async base=>{const r=await fetch(base+'/api/program',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({padding:'x'.repeat(1500)})});assert.equal(r.status,413);},{maxBodyBytes:1024});assert.equal(calls,0);
});
test('timeout aborts pending provider work without a retry',{timeout:5000},async()=>{
 let calls=0,aborted=false;const provider=configured(async(_,o)=>{calls++;return new Promise((_,reject)=>{const cancel=()=>{aborted=true;reject(Error('aborted'));};if(o.signal.aborted)cancel();else o.signal.addEventListener('abort',cancel,{once:true});});},{attemptTimeoutMs:1000});
 await withServer(provider,async base=>{const r=await post(base);assert.ok([502,504].includes(r.status));assert.equal(aborted,true);},{timeoutMs:30});assert.equal(calls,1);
});
test('concurrent requests cannot fan out provider calls',{timeout:5000},async()=>{
 let calls=0,release,signalStarted;const started=new Promise(done=>{signalStarted=done;}),provider=configured(async()=>{calls++;signalStarted();return new Promise(done=>{release=()=>done(response(good()));});});
 await withServer(provider,async base=>{const first=post(base);await started;assert.equal((await post(base)).status,429);assert.equal(calls,1);release();assert.equal((await first).status,200);});
});
test('failed second transport preserves first receipt with no third dispatch',async()=>{
 let calls=0;const observed=[],provider=observeAttempts(configured(async()=>{calls++;if(calls===1)return response(bad());throw Error('Unknown '+KEY);}),observed);
 await withServer(provider,async base=>{const r=await post(base);assert.equal(r.status,502);const v=await r.json();assert.equal(observed.length,1);assert.equal(v.attempts.length,1);assert.equal(v.attempts[0].validation,'rejected');assert.equal(v.attempts[0].evidence.requestId,observed[0].evidence.requestId);assert.deepEqual(v.attempts[0].evidence.usage,observed[0].evidence.usage);assert.deepEqual(v.failedAttempt,{attempt:2,outcome:'unknown'});assert.equal(JSON.stringify(v).includes(KEY),false);});assert.equal(calls,2);
});
test('outer timeout retains confirmed first receipt and does not invent the second',{timeout:5000},async()=>{
 let calls=0,aborted=false;const observed=[],provider=observeAttempts(configured(async(_,o)=>{calls++;if(calls===1)return response(bad());return new Promise((_,reject)=>{const cancel=()=>{aborted=true;reject(Error('aborted second request'));};if(o.signal.aborted)cancel();else o.signal.addEventListener('abort',cancel,{once:true});});},{attemptTimeoutMs:2000}),observed);
 await withServer(provider,async base=>{const r=await post(base);assert.ok([502,504].includes(r.status));const v=await r.json();assert.equal(aborted,true);assert.equal(observed.length,1);assert.equal(v.attempts.length,1);assert.equal(v.attempts[0].evidence.requestId,observed[0].evidence.requestId);assert.deepEqual(v.attempts[0].evidence.usage,observed[0].evidence.usage);assert.deepEqual(v.failedAttempt,{attempt:2,outcome:'unknown'});},{timeoutMs:250});assert.equal(calls,2);
});
test('accepted repair receipts survive custody with every imported origin downgraded',async()=>{
 let calls=0;const observed=[],provider=observeAttempts(configured(async()=>{calls++;const r=response(calls===1?bad():good());r.headers.set('x-request-id','custody-attempt-'+calls);return r;}),observed);
 await withServer(provider,async base=>{const r=await post(base);assert.equal(r.status,200);const v=await r.json();assert.deepEqual(observed.map(a=>a.validation),['rejected','accepted']);assert.deepEqual(v.attempts.map(a=>a.evidence.requestId),['custody-attempt-1','custody-attempt-2']);
 const accepted=proposeProgram(project,v.program);assert.equal(accepted.ok,true);const saved=await encodeProject(accepted.project,{modelEvidence:{...v.evidence,attempts:v.attempts}}),loaded=await decodeProject(JSON.parse(JSON.stringify(saved)));assert.equal(saved.modelEvidence.attempts.length,2);assert.equal(loaded.modelEvidence.evidenceOrigin,'imported_unverified');
 for(let i=0;i<2;i++){const a=loaded.modelEvidence.attempts[i];assert.equal(a.evidence.evidenceOrigin,'imported_unverified');assert.equal(a.evidence.requestId,'custody-attempt-'+(i+1));assert.deepEqual(a.evidence.usage,v.attempts[i].evidence.usage);}
 const resaved=await encodeProject(loaded.project,{modelEvidence:loaded.modelEvidence});assert.equal(resaved.modelEvidence.evidenceOrigin,'imported_unverified');assert.ok(resaved.modelEvidence.attempts.every(a=>a.evidence.evidenceOrigin==='imported_unverified'));
 });assert.equal(calls,2);
});
