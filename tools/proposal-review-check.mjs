import {compileScore,proposeRelationshipEdit,acceptNoteChanges} from '../src/score.mjs';
import {createDemoProject} from '../src/demo.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,basename} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createAppServer} from '../server.mjs';
import {encodeProject,decodeProject} from '../src/project.mjs';
class CDP{
 constructor(ws){this.ws=ws;this.next=1;this.pending=new Map();this.listeners=new Set();ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(p.method+': '+m.error.message)):p.resolve(m.result||{});}else for(const fn of this.listeners)fn(m);});ws.addEventListener('close',()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('CDP closed'));}this.pending.clear();});}
 static async connect(url){const ws=new WebSocket(url);await new Promise((done,fail)=>{const timer=setTimeout(()=>fail(Error('CDP connection timeout')),10000);ws.addEventListener('open',()=>{clearTimeout(timer);done();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);fail(Error('CDP connection failed'));},{once:true});});return new CDP(ws);}
 send(method,params={},sessionId){return new Promise((done,fail)=>{const id=this.next++,timer=setTimeout(()=>{this.pending.delete(id);fail(Error('CDP timeout: '+method));},30000);this.pending.set(id,{resolve:done,reject:fail,timer,method});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
 on(fn){this.listeners.add(fn);}close(){this.ws.close();}
}
async function until(fn,message,timeout=60000){const start=Date.now();let last;while(Date.now()-start<timeout){try{const value=await fn();if(value)return value;}catch(error){last=error;}await delay(80);}throw Error(message+(last?': '+last.message:''));}
const state=n=>({id:n.id,startTick:n.startTick,durationTicks:n.durationTicks,pitch:n.pitch,velocity:n.velocity,muted:n.muted,channel:n.channel,program:n.program});
const artifacts=resolve('artifacts');await mkdir(join(artifacts,'browser-receiving'),{recursive:true});
const receiving=await mkdtemp(join(artifacts,'browser-receiving','threadscore-')),profile=await mkdtemp(join(tmpdir(),'threadscore-chrome-'));
const report={startedAt:new Date().toISOString(),receiving,checks:[],downloads:[],screenshots:[],uncaught:[],requests:[]};
let server,chrome,cdp,sessionId,stderr='';
try{
 server=createAppServer();await new Promise((done,fail)=>{server.once('error',fail);server.listen(Number(process.env.PORT||0),'127.0.0.1',done);});const origin=process.env.THREADSCORE_BASE_URL||'http://127.0.0.1:'+server.address().port;
 chrome=spawn(process.env.THREADSCORE_CHROME||'/usr/local/bin/google-chrome',['--headless=new','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});let spawnError;chrome.on('error',e=>{spawnError=e;});chrome.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-12000);});
 const endpoint=await until(async()=>{if(spawnError)throw spawnError;if(chrome.exitCode!==null)throw Error('Chrome exited: '+stderr);const lines=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');return lines.length>=2&&'ws://127.0.0.1:'+lines[0]+lines[1];},'Chrome debugging endpoint unavailable',15000);cdp=await CDP.connect(endpoint);
 const downloads=new Map();cdp.on(m=>{if(m.method==='Runtime.exceptionThrown')report.uncaught.push(m.params.exceptionDetails);if(m.method==='Network.requestWillBeSent')report.requests.push(m.params.request.url);if(m.method==='Browser.downloadWillBegin')downloads.set(m.params.guid,{...m.params,state:'started'});if(m.method==='Browser.downloadProgress'){const d=downloads.get(m.params.guid)||{guid:m.params.guid};Object.assign(d,m.params);downloads.set(d.guid,d);}});
 await cdp.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:receiving,eventsEnabled:true});const target=await cdp.send('Target.createTarget',{url:'about:blank'});({sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true}));for(const method of ['Page.enable','Runtime.enable','Network.enable'])await cdp.send(method,{},sessionId);
 const evaluate=async expression=>{const result=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},sessionId);if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
 const click=selector=>evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)throw Error("Missing control");if(e.disabled)throw Error("Disabled control");e.click();return true;})()');
 const change=(selector,value)=>evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)throw Error("Missing field");e.value='+JSON.stringify(String(value))+';e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true;})()');
 const visible=selector=>'(()=>{const e=document.querySelector('+JSON.stringify(selector)+');return !!e&&!e.hidden&&e.getClientRects().length>0;})()';
 const ready=()=>until(()=>evaluate('!!document.querySelector("#project-save")&&!document.querySelector("#project-save").disabled'),'App not ready');
 const upload=async(selector,file)=>{const {root}=await cdp.send('DOM.getDocument',{depth:0},sessionId),{nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector},sessionId);assert.ok(nodeId);await cdp.send('DOM.setFileInputFiles',{nodeId,files:[file]},sessionId);};
 const download=async selector=>{await ready();const known=new Set(downloads.keys());await click(selector);const item=await until(()=>[...downloads.values()].find(d=>!known.has(d.guid)&&d.state==='completed'),'Download failed: '+selector);const file=join(receiving,String(report.downloads.length+1).padStart(2,'0')+'-'+basename(item.suggestedFilename||'download.bin'));await copyFile(join(receiving,item.guid),file);const bytes=await readFile(file);report.downloads.push({selector,file,filename:item.suggestedFilename,bytes:bytes.length});return {file,bytes};};
 const projectDownload=async()=>{const d=await download('#project-save');return {...d,...await decodeProject(JSON.parse(d.bytes.toString('utf8')))};};
 const check=message=>{report.checks.push(message);console.log('[browser] '+message);};
 const capture=async(name,width,height,mobile,scrollSelector=null)=>{await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile},sessionId);await evaluate('document.fonts.ready.then(()=>true)');await evaluate(scrollSelector?'document.querySelector('+JSON.stringify(scrollSelector)+').scrollIntoView({block:"start"})':'scrollTo(0,0)');await delay(100);const dimensions=await evaluate('({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth})'),shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true},sessionId),file=join(artifacts,'threadscore-'+name+'.png');await writeFile(file,Buffer.from(shot.data,'base64'));report.screenshots.push({file,width,height,mobile,dimensions});assert.ok(dimensions.document<=dimensions.viewport+1,name+' horizontal overflow: '+JSON.stringify(dimensions));};
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);await cdp.send('Page.navigate',{url:origin+'/'},sessionId);await ready();await until(()=>evaluate('document.querySelectorAll("#relations-list .relation-item").length===6'),'Demo did not render');

 // A single source drives eight independent 64-note targets: exactly 512 changes.
 const notes=Array.from({length:64},(_,i)=>({id:'n'+String(i).padStart(3,'0'),startTick:i*60,durationTicks:45,pitch:60+i%8,velocity:80}));
 const fixture={schemaVersion:1,id:'proposal-review-512',title:'Proposal receiving 512',revision:0,ppq:480,bpm:120,durationTicks:8*3840,
  sections:[{id:'room',name:'Room',startTick:0,endTick:8*3840}],motifs:[{id:'motif',name:'Motif',lengthTicks:3840,notes}],
  threads:[{id:'source',name:'Source',motifId:'motif',channel:0,program:0},{id:'target',name:'Target',motifId:'motif',channel:1,program:0}],
  occurrences:[{id:'source-room',threadId:'source',sectionId:'room',startTick:0,transpose:0},...Array.from({length:8},(_,i)=>({id:'target-'+i,threadId:'target',sectionId:'room',startTick:i*3840,transpose:0}))],
  relations:[{id:'wide-shadow',kind:'shadow',sourceThreadId:'source',targetThreadId:'target',sourceOccurrenceId:'source-room',scopeOccurrenceIds:Array.from({length:8},(_,i)=>'target-'+i),params:{interval:0,delayTicks:0,velocityScale:1}}],locks:{},noteOverrides:{}};
 const proposed=proposeRelationshipEdit(fixture,'wide-shadow',{params:{interval:1,delayTicks:0,velocityScale:1}});assert.ok(proposed.ok,JSON.stringify(proposed.errors));assert.equal(proposed.diff.length,512);
 const fixturePath=join(receiving,'proposal-512.json');await writeFile(fixturePath,JSON.stringify(await encodeProject(fixture)));
 const open=async file=>{await evaluate('document.querySelector("#status").textContent=""');await click('#project-open');await upload('#project-file',file);await until(()=>evaluate('document.querySelector("#status").textContent.startsWith("Opened and recompiled")'),'Open score failed');};
 const preview=async()=>{await change('#param-interval',1);await click('#preview-relationship');await until(()=>evaluate(visible('#proposal-panel')),'Proposal missing');};
 const search='#changes input[type=search]',jump='#changes select[aria-label="Change page"]';
 const ids=()=>evaluate('[...document.querySelectorAll("#changes input[data-note-id]")].map(e=>e.dataset.noteId)');
 const checkbox=id=>'#changes input[data-note-id='+JSON.stringify(id)+']';
 await open(fixturePath);await preview();assert.match(await evaluate('document.querySelector("#proposal-summary").textContent'),/^512 notes change/);
 if(process.env.THREADSCORE_EXPECT_LEGACY_CAP==='1'){
  assert.equal((await ids()).length,300);assert.equal(await evaluate('document.querySelector('+JSON.stringify(jump)+')===null'),true);
  report.legacyCap={expectedDiff:512,rendered:300,navigationAbsent:true};check('Legacy cap reproduced: 512 actual changes, 300 reachable rows, no navigation');
 }else{
 const seen=[];for(let page=0;page<6;page++){await evaluate('document.querySelector('+JSON.stringify(jump)+').focus()');await change(jump,page);assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Change page');const rows=await ids();assert.ok(rows.length<=100);seen.push(...rows);}
 assert.deepEqual(seen,proposed.diff.map(d=>d.noteId));assert.equal(new Set(seen).size,512);check('All 512 actual diff IDs reachable through six bounded pages, without duplication');
 const passage='#changes select[aria-label="Filter changed notes by passage"]';
 const action=label=>evaluate('(()=>{const b=[...document.querySelectorAll("#changes button")].find(e=>e.textContent==='+JSON.stringify(label)+');if(!b||b.disabled)throw Error("Unavailable review action");b.click();})()');
 await change(jump,0);await click(checkbox(seen[0]));await change(passage,'target-7');assert.equal((await ids()).length,64);
 await action('Select this page');assert.match(await evaluate('document.querySelector("#changes [role=status]").textContent'),/ · 65 selected across/);
 await action('Clear this page');assert.match(await evaluate('document.querySelector("#changes [role=status]").textContent'),/ · 1 selected across/);
 await action('Select this page');await change(search,'no-such-note');assert.deepEqual(await ids(),[]);await action('Clear selection');assert.equal(await evaluate('document.querySelector("#accept-selected").disabled'),true);
 await change(search,'');await change(passage,'');await change(jump,0);assert.equal(await evaluate('document.querySelectorAll("#changes input:checked").length'),0);
 check('Passage-scoped select/clear preserves hidden selection; global clear works even with zero matching rows');
 const first=seen[0],late=seen[401];await change(jump,0);await click(checkbox(first));await change(jump,4);await click(checkbox(late));
 await change(search,late);assert.deepEqual(await ids(),[late]);assert.equal(await evaluate('document.querySelector("#accept-selected").textContent'),'Accept 2 selected note edits');
 await change(search,'nothing-matches-this');assert.deepEqual(await ids(),[]);assert.match(await evaluate('document.querySelector("#changes [role=status]").textContent'),/512 total changes · 2 selected/);
 await change(search,'');await change(jump,0);assert.equal(await evaluate('document.querySelector('+JSON.stringify(checkbox(first))+').checked'),true);await click(checkbox(first));await change(jump,4);assert.equal(await evaluate('document.querySelector('+JSON.stringify(checkbox(late))+').checked'),true);
 // A real keyboard Space toggles the late checkbox and preserves its focused node.
 await evaluate('document.querySelector('+JSON.stringify(checkbox(late))+').focus()');
 for(let i=0;i<2;i++){await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32},sessionId);await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32},sessionId);}
 assert.equal(await evaluate('document.activeElement.dataset.noteId'),late);assert.equal(await evaluate('document.activeElement.checked'),true);
 await capture('proposal-desktop',1440,1000,false,'#proposal-panel');
 await capture('proposal-mobile',390,844,true,'#proposal-panel');
 await evaluate('document.querySelector('+JSON.stringify(search)+').focus()');await change(search,late);assert.equal(await evaluate('document.activeElement.getAttribute("type")'),'search');
 const dims=await evaluate('(()=>{const e=document.querySelector("#changes");return {scroll:e.scrollWidth,width:e.clientWidth};})()');assert.ok(dims.scroll<=dims.width+1,JSON.stringify(dims));
 check('Cross-page/filter IDs and exact selected counts survive empty filters; keyboard checkbox and search focus work at 390px');
 await click('#accept-selected');await until(()=>evaluate('document.querySelector("#proposal-panel").hidden'),'Partial acceptance did not close proposal');
 const accepted=await projectDownload(),base=compileScore(fixture).score,before=new Map(base.notes.map(n=>[n.id,n]));
 assert.deepEqual(accepted.project.relations,fixture.relations);assert.deepEqual(Object.keys(accepted.project.noteOverrides),[late]);assert.equal(accepted.project.revision,1);
 assert.deepEqual(accepted.score.notes.filter(n=>JSON.stringify(state(n))!==JSON.stringify(state(before.get(n.id)))).map(n=>n.id),[late]);
 assert.deepEqual(state(accepted.score.notes.find(n=>n.id===late)),state(proposed.score.notes.find(n=>n.id===late)));await open(accepted.file);assert.deepEqual((await projectDownload()).project,accepted.project);
 check('Late note 402 accepts alone; downloaded/reopened score preserves program and every unselected performed note');
 await open(fixturePath);await preview();await change(jump,4);await click(checkbox(late));await click('#discard-proposal');assert.equal(await evaluate('document.querySelector("#proposal-panel").hidden'),true);assert.deepEqual((await projectDownload()).project,fixture);
 await preview();assert.equal(await evaluate('document.querySelector("#accept-selected").disabled'),true);assert.equal(await evaluate('document.querySelector('+JSON.stringify(jump)+').value'),'0');
 await change('#param-interval',2);assert.equal(await evaluate('document.querySelector("#proposal-panel").hidden'),true);await open(fixturePath);await preview();await click('#demo-reset');assert.equal(await evaluate('document.querySelector("#proposal-panel").hidden'),true);
 check('Discard preserves source; re-preview, parameter invalidation, Open score and reset clear stale draft selections');
 const demo=createDemoProject(),demoProposal=proposeRelationshipEdit(demo,'answer-exchange',{params:{...demo.relations.find(r=>r.id==='answer-exchange').params,interval:4}});assert.ok(demoProposal.ok);
 const dependent=demoProposal.diff.find(d=>{const r=acceptNoteChanges(demo,demoProposal,[d.noteId]);return !r.ok&&r.errors.some(e=>e.code==='PARTIAL_DEPENDENCY'&&e.requiredNoteIds?.length>0);});assert.ok(dependent,'Fixture must expose a real downstream dependency');
 const demoPath=join(receiving,'dependency-demo.json');await writeFile(demoPath,JSON.stringify(await encodeProject(demo)));await open(demoPath);await click('#relations-list .relation-item[data-relation-id="answer-exchange"]');await change('#param-interval',4);await click('#preview-relationship');await click(checkbox(dependent.noteId));await click('#accept-selected');
 await until(()=>evaluate('/unselected dependent notes/.test(document.querySelector("#status").textContent)'),'Dependency rejection missing');assert.deepEqual((await projectDownload()).project,demo);assert.equal(await evaluate('document.querySelector('+JSON.stringify(checkbox(dependent.noteId))+').checked'),true);
 await click('#accept-relationship');assert.equal(await evaluate('document.querySelector("#proposal-panel").hidden'),true);assert.equal((await projectDownload()).project.relations.find(r=>r.id==='answer-exchange').params.interval,4);
 check('Compiler-derived dependency rejection preserves project and selection, then full acceptance recovers');

 const detail=structuredClone(fixture);detail.id='proposal-fields';detail.title='Exact changed fields';detail.occurrences=detail.occurrences.slice(0,2);detail.relations[0].scopeOccurrenceIds=['target-0'];
 detail.motifs[0].notes=[{id:'s0',startTick:60,durationTicks:45,pitch:60,velocity:80},{id:'s1',startTick:240,durationTicks:45,pitch:64,velocity:90}];
 detail.motifs.push({id:'target-motif',name:'Target timing',lengthTicks:3840,notes:[{id:'t0',startTick:0,durationTicks:100,pitch:60,velocity:80},{id:'t1',startTick:120,durationTicks:100,pitch:64,velocity:90}]});detail.threads[1].motifId='target-motif';
 const fieldProposal=proposeRelationshipEdit(detail,'wide-shadow',{kind:'interrupt',params:{sourceNoteIndex:0,gapTicks:180}});assert.ok(fieldProposal.ok,JSON.stringify(fieldProposal.errors));assert.equal(fieldProposal.diff.length,2);
 const detailPath=join(receiving,'changed-fields.json');await writeFile(detailPath,JSON.stringify(await encodeProject(detail)));await open(detailPath);await change('#relation-kind','interrupt');await change('#param-sourceNoteIndex',0);await change('#param-gapTicks',180);await click('#preview-relationship');
 const verifiedFields=new Set();for(const d of fieldProposal.diff){const text=await evaluate('document.querySelector('+JSON.stringify(checkbox(d.noteId))+').closest("label").querySelector("small").textContent');for(const [key,label] of [['startTick','Start tick'],['durationTicks','Duration ticks'],['velocity','Velocity'],['muted','Sound']])if(d.before[key]!==d.after[key]){const show=v=>key==='muted'?(v?'rest':'audible'):String(v);assert.ok(text.includes(label+': '+show(d.before[key])+' → '+show(d.after[key])),text);verifiedFields.add(key);}}
 for(const field of ['startTick','durationTicks','muted'])assert.ok(verifiedFields.has(field),'Missing changed field coverage: '+field);
 check('Compiler-derived interrupt proposal shows exact old/new start ticks, durations and audible-to-rest state');
 }
 assert.equal(report.uncaught.length,0,JSON.stringify(report.uncaught));assert.deepEqual(report.requests.filter(url=>/^https?:/.test(url)&&!url.startsWith(origin+'/')),[]);assert.deepEqual(report.requests.filter(url=>/^https?:/.test(url)&&new URL(url).pathname==='/api/program'),[]);
 report.ok=true;report.finishedAt=new Date().toISOString();await writeFile(join(artifacts,'threadscore-proposal-review-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,checks:report.checks,screenshots:report.screenshots,report:join(artifacts,'threadscore-proposal-review-check.json')},null,2));
}catch(error){report.ok=false;report.error=error.stack;report.chromeStderr=stderr;report.finishedAt=new Date().toISOString();await writeFile(join(artifacts,'threadscore-proposal-review-check.json'),JSON.stringify(report,null,2));console.error(error.stack);process.exitCode=1;}
finally{cdp?.close();if(chrome&&chrome.exitCode===null){chrome.kill('SIGTERM');await Promise.race([new Promise(done=>chrome.once('exit',done)),delay(4000)]);if(chrome.exitCode===null){chrome.kill('SIGKILL');await Promise.race([new Promise(done=>chrome.once('exit',done)),delay(2000)]);}}if(server){server.closeAllConnections?.();await new Promise(done=>server.close(done));}await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
