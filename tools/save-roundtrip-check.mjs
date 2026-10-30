import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,basename} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
const sourceRoot=resolve(process.argv[2]||fileURLToPath(new URL('..',import.meta.url))),mode=process.argv[3]||'fixed';
if(!['baseline','fixed'].includes(mode))throw Error('Usage: node tools/save-roundtrip-check.mjs [SOURCE_ROOT] [fixed|baseline]');
const {createAppServer}=await import(pathToFileURL(join(sourceRoot,'server.mjs')).href);
const {encodeProject,decodeProject}=await import(pathToFileURL(join(sourceRoot,'src/project.mjs')).href);
const {setNoteLocks,compileScore}=await import(pathToFileURL(join(sourceRoot,'src/score.mjs')).href);
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
const report={sourceRoot,mode,startedAt:new Date().toISOString(),receiving,checks:[],downloads:[],screenshots:[],uncaught:[],requests:[]};
let server,chrome,cdp,sessionId,stderr='';
try{
 server=createAppServer();await new Promise((done,fail)=>{server.once('error',fail);server.listen(Number(process.env.PORT||0),'127.0.0.1',done);});const origin='http://127.0.0.1:'+server.address().port;
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

 const LIMIT=2*1024*1024,LENGTH=128*120;
 const family={schemaVersion:1,id:'save-boundary',title:'Repeated piano study with performed note pins',revision:0,ppq:480,bpm:120,durationTicks:36*LENGTH,
 sections:[{id:'study',name:'Study',startTick:0,endTick:36*LENGTH}],
 motifs:[{id:'phrase',name:'Piano phrase',lengthTicks:LENGTH,notes:Array.from({length:128},(_,i)=>({id:'note-'+String(i).padStart(3,'0'),startTick:i*120,durationTicks:90,pitch:60+i%12,velocity:80}))}],
 threads:[{id:'piano',name:'Piano',motifId:'phrase',channel:0,program:0}],
 occurrences:Array.from({length:36},(_,i)=>({id:'passage-'+String(i).padStart(2,'0'),threadId:'piano',sectionId:'study',startTick:i*LENGTH,transpose:0})),relations:[],locks:{},noteOverrides:{}};
 const initial=compileScore(family);assert.ok(initial.ok,JSON.stringify(initial.errors));assert.equal(initial.score.notes.length,4608);
 const locked=setNoteLocks(family,initial.score.notes.slice(0,4519).map(n=>n.id),true);assert.ok(locked.ok,JSON.stringify(locked.errors));
 const originalDocument=await encodeProject(locked.project),pretty=JSON.stringify(originalDocument,null,2),prettyPath=join(receiving,'oversized-pretty.json');
 assert.equal(Object.keys(locked.project.locks).length,4519);assert.ok(Buffer.byteLength(pretty)>LIMIT,'Confirmed pretty boundary no longer crosses');await writeFile(prettyPath,pretty);
 const validated=await decodeProject(originalDocument);await encodeProject(validated.project);
 const compact=JSON.stringify(originalDocument),compactPath=join(receiving,'input-compact.json');assert.ok(Buffer.byteLength(compact)<=LIMIT);await writeFile(compactPath,compact);
 report.fixture={compactBytes:Buffer.byteLength(compact),notes:validated.score.notes.length,pins:Object.keys(validated.project.locks||{}).length};
 const open=async file=>{await evaluate('document.querySelector("#status").textContent=""');await click('#project-open');await upload('#project-file',file);};
 const opened=()=>until(()=>evaluate('document.querySelector("#status").textContent.startsWith("Opened and recompiled")'),'Open score failed');
 await open(compactPath);await opened();const saved=await projectDownload();assert.deepEqual(saved.project,validated.project);assert.deepEqual(saved.score,validated.score);
 report.firstDownloadBytes=saved.bytes.length;check('Validated compact fixture opens and actual Save download preserves exact project, pins and compiled score');
 const renamedTitle='Renamed after save';await change('#project-title',renamedTitle);await until(()=>evaluate('document.querySelector("#status").textContent==="Composition renamed."'),'Rename did not commit');
 const renamed=await projectDownload();assert.equal(renamed.project.title,renamedTitle);assert.equal(renamed.project.revision,validated.project.revision+1);
 await open(saved.file);
 if(mode==='baseline'){
  assert.ok(saved.bytes.length>LIMIT,'Baseline did not produce oversized download');await until(()=>evaluate('/no larger than 2 MiB/.test(document.querySelector("#status").textContent)'),'Oversized actual download was not rejected');
  report.reopenStatus=await evaluate('document.querySelector("#status").textContent');assert.equal(await evaluate('document.querySelector("#project-title").value'),renamedTitle);
  const retained=await projectDownload();assert.deepEqual(retained.project,renamed.project);assert.deepEqual(retained.score,renamed.score);check('Actual oversized Save download fails Open and leaves renamed current project, pins and score unchanged');
 }else{
  assert.ok(saved.bytes.length<=LIMIT,'Fixed Save still exceeds input limit');await opened();const reopened=await projectDownload();assert.ok(reopened.bytes.length<=LIMIT);assert.deepEqual(reopened.project,validated.project);assert.deepEqual(reopened.project.locks,validated.project.locks);assert.deepEqual(reopened.score,validated.score);assert.equal(await evaluate('document.querySelector("#project-title").value'),validated.project.title);check('Exact downloaded file reopens within2MiB and restores original project, all pins and compiled score');
 }
 if(mode==='fixed'){
  const unicodeTitle='旋律 — café 🎼';await change('#project-title',unicodeTitle);await until(()=>evaluate('document.querySelector("#status").textContent==="Composition renamed."'),'Unicode rename failed');
  const unicode=await projectDownload();assert.equal(unicode.project.title,unicodeTitle);assert.ok(unicode.bytes.length<=LIMIT);assert.equal(unicode.bytes.length,Buffer.byteLength(unicode.bytes.toString('utf8'),'utf8'));assert.ok(unicode.bytes.length>unicode.bytes.toString('utf8').length,'Unicode fixture did not exercise multibyte bytes');
  report.unicode={title:unicodeTitle,downloadBytes:unicode.bytes.length,characters:unicode.bytes.toString('utf8').length};
  await change('#project-title','Temporary rename');await until(()=>evaluate('document.querySelector("#status").textContent==="Composition renamed."'),'Temporary rename failed');await open(unicode.file);await opened();const unicodeReopened=await projectDownload();assert.deepEqual(unicodeReopened.project,unicode.project);assert.deepEqual(unicodeReopened.score,unicode.score);
  check('Unicode title round-trips through actual UTF-8 download within byte limit');
  await open(prettyPath);await until(()=>evaluate('/no larger than 2 MiB/.test(document.querySelector("#status").textContent)'),'Original oversized pretty file was not rejected');
  const afterReject=await projectDownload();assert.deepEqual(afterReject.project,unicode.project);assert.deepEqual(afterReject.score,unicode.score);check('Original oversized pretty file remains rejected without changing current Unicode project, pins or score');
 }
 assert.equal(report.uncaught.length,0,JSON.stringify(report.uncaught));assert.deepEqual(report.requests.filter(url=>/^https?:/.test(url)&&!url.startsWith(origin+'/')),[]);assert.deepEqual(report.requests.filter(url=>/^https?:/.test(url)&&new URL(url).pathname==='/api/program'),[]);
 report.ok=true;
}catch(error){report.ok=false;report.error=error.stack;report.chromeStderr=stderr;console.error(error.stack);process.exitCode=1;}
finally{
 try{cdp?.close();if(chrome&&chrome.exitCode===null){chrome.kill('SIGTERM');await Promise.race([new Promise(done=>chrome.once('exit',done)),delay(4000)]);if(chrome.exitCode===null){chrome.kill('SIGKILL');await Promise.race([new Promise(done=>chrome.once('exit',done)),delay(2000)]);}}if(server){server.closeAllConnections?.();await new Promise(done=>server.close(done));}await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
 catch(error){report.ok=false;report.cleanupError=String(error);process.exitCode=1;}
 report.finishedAt=new Date().toISOString();const reportPath=join(receiving,'save-roundtrip-check.json');await writeFile(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,mode,report:reportPath,checks:report.checks,fixture:report.fixture,firstDownloadBytes:report.firstDownloadBytes},null,2));
}
