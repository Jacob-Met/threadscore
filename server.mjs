import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {decodeProject} from './src/project.mjs';
import {proposeProgram} from './src/score.mjs';
const ROOT=dirname(fileURLToPath(import.meta.url)),DEFAULT_MODEL='nvidia/Nemotron-3_5-Lightning';
const FILES=new Map([
 ['/', ['public/index.html','text/html; charset=utf-8']],['/index.html',['public/index.html','text/html; charset=utf-8']],
 ['/app.mjs',['public/app.mjs','text/javascript; charset=utf-8']],['/style.css',['public/style.css','text/css; charset=utf-8']],
 ['/audio-worker.mjs',['public/audio-worker.mjs','text/javascript; charset=utf-8']],['/playback.mjs',['public/playback.mjs','text/javascript; charset=utf-8']],
 ...['score','demo','midi','project','synth','zip','import'].map(name=>['/src/'+name+'.mjs',['src/'+name+'.mjs','text/javascript; charset=utf-8']])
]);
const CSP="default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
function send(res,status,value,extra={}){const text=JSON.stringify(value);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':CSP,...extra});res.end(text);}
function receipt(value){
 const output={};
 for(const key of ['provider','model','receivedModel','requestId','role','createdAt'])if(typeof value?.[key]==='string')output[key]=value[key].slice(0,key==='role'?2048:512);
 if(Number.isFinite(value?.latencyMs)&&value.latencyMs>=0)output.latencyMs=value.latencyMs;
 if(value?.usage&&typeof value.usage==='object'){output.usage={};for(const key of ['prompt_tokens','completion_tokens','total_tokens'])if(Number.isSafeInteger(value.usage[key])&&value.usage[key]>=0&&value.usage[key]<=1000000000)output.usage[key]=value.usage[key];}
 output.cost=Number.isFinite(value?.cost)&&value.cost>=0?value.cost:null;output.audioSent=false;output.evidenceOrigin='live_receipt_this_session';return output;
}
function attemptReceipts(records){return Array.isArray(records)?records.slice(0,2).map((a,i)=>({attempt:i+1,validation:a.validation==='accepted'?'accepted':'rejected',evidence:receipt(a.evidence)})):[];}
function providerError(cause,observed=[]){
 const invalid=cause?.code==='INVALID_PROGRAM',limited=cause?.code==='CONTEXT_LIMIT';
 const result=cause instanceof HttpError?cause:new HttpError(invalid||limited?422:502,invalid?'Provider did not produce a valid composition program within the repair limit.':limited?'This project exceeds the optional model context; local editing remains available.':'Provider request failed or its outcome is unknown; no automatic retry was made.');
 result.attempts=attemptReceipts(cause?.attempts??observed);
 const failed=cause?.failedAttempt;
 if(failed&&Number.isInteger(failed.attempt)&&failed.attempt>=1&&failed.attempt<=2&&['unknown','failed_without_valid_model_envelope'].includes(failed.outcome))result.failedAttempt={attempt:failed.attempt,outcome:failed.outcome};
 else if(result.status===504)result.failedAttempt={attempt:Math.min(2,result.attempts.length+1),outcome:'unknown'};
 return result;
}
function bodyJson(req,maximum){
 const declared=req.headers['content-length'];if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>maximum))return Promise.reject(new HttpError(413,'Request exceeds the supported body limit.'));
 return new Promise((resolveBody,reject)=>{
  let size=0,settled=false;const chunks=[],fail=error=>{if(!settled){settled=true;reject(error);}};
  req.on('error',()=>fail(new HttpError(400,'Request body could not be read.')));req.on('aborted',()=>fail(new HttpError(400,'Request was interrupted.')));
  req.on('data',chunk=>{if(settled)return;size+=chunk.length;if(size>maximum){chunks.length=0;fail(new HttpError(413,'Request exceeds the supported body limit.'));return;}chunks.push(chunk);});
  req.on('end',()=>{if(settled)return;try{const value=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));settled=true;resolveBody(value);}catch{fail(new HttpError(400,'Request must contain valid JSON.'));}});
 });
}
function validateOrigin(req,server){
 let host;try{host=new URL('http://'+(req.headers.host??''));}catch{throw new HttpError(403,'Invalid local host.');}
 const address=server.address(),port=typeof address==='object'&&address?address.port:null;
 if(host.username||host.password||host.pathname!=='/'||host.search||host.hash||!['localhost','127.0.0.1','[::1]'].includes(host.hostname)||Number(host.port||80)!==port)throw new HttpError(403,'Only the current local host is accepted.');
 const origin=req.headers.origin;if(origin!==undefined&&origin!==host.origin)throw new HttpError(403,'Cross-origin requests are not accepted.');
 if(req.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'Cross-site requests are not accepted.');
}
export function createAppServer({provider=null,rootDir=ROOT,timeoutMs=20000,maxBodyBytes=2*1024*1024+16384}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>60000)throw new TypeError('timeoutMs must be 10–60000.');
 if(!Number.isInteger(maxBodyBytes)||maxBodyBytes<1024||maxBodyBytes>3*1024*1024)throw new TypeError('Invalid maxBodyBytes.');
 let inFlight=false;const available=()=>provider?.available!==false&&typeof provider?.propose==='function';
 const server=http.createServer(async(req,res)=>{
  try{
   validateOrigin(req,server);
   if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//')||/%2e|%2f|%5c|\\/i.test(req.url)||/\/(?:\.\.?)(?:\/|$)/.test(req.url.split('?')[0]))throw new HttpError(404,'Not found.');
   const url=new URL(req.url,'http://'+req.headers.host);
   if(url.pathname==='/api/capabilities'&&req.method==='GET'){send(res,200,{available:available(),model:provider?.model??DEFAULT_MODEL,reason:available()?null:'Optional model calls are disabled or the maintained credential is unavailable.',audioSent:false});return;}
   if(url.pathname==='/api/program'&&req.method==='POST'){
    if(!available())throw new HttpError(503,'Optional composition-program generation is unavailable. Local editing and exports remain available.');
    if(inFlight)throw new HttpError(429,'One composition request is already in progress.');
    if((req.headers['content-type']??'').split(';')[0].trim().toLowerCase()!=='application/json')throw new HttpError(415,'Use application/json.');
    inFlight=true;const aborter=new AbortController(),knownAttempts=[];let timer;const onClose=()=>{if(!res.writableEnded)aborter.abort();};res.once('close',onClose);
    try{
     const body=await bodyJson(req,maxBodyBytes);
     if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['document','instruction'].includes(k)))throw new HttpError(400,'Expected only document and instruction.');
     if(typeof body.instruction!=='string'||!body.instruction.trim()||body.instruction.length>2000)throw new HttpError(400,'Instruction must contain 1–2000 characters.');
     let loaded;try{loaded=await decodeProject(body.document);}catch{throw new HttpError(422,'Project document failed integrity or compilation validation.');}
     const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{aborter.abort();reject(providerError(new HttpError(504,'Provider outcome is unknown after timeout; no automatic retry was made.'),knownAttempts));},timeoutMs);});
     let result;try{result=await Promise.race([provider.propose({project:loaded.project,document:body.document,instruction:body.instruction.trim(),signal:aborter.signal,onAttempt:record=>{if(knownAttempts.length<2)knownAttempts.push(attemptReceipts([record])[0]);}}),timeout]);}catch(error){throw providerError(error,knownAttempts);}
     const proposal=proposeProgram(loaded.project,result?.program);if(!proposal?.ok)throw new HttpError(422,'Returned program was rejected by the project compiler.');
     const evidence=receipt(result.evidence),attempts=Array.isArray(result.attempts)?attemptReceipts(result.attempts):[{attempt:1,validation:'accepted',evidence}];
     const output={program:proposal.program,evidence,attempts};if(Buffer.byteLength(JSON.stringify(output))>128*1024)throw new HttpError(502,'Provider program exceeded the response limit.');send(res,200,output);
    }finally{clearTimeout(timer);res.off('close',onClose);inFlight=false;}
    return;
   }
   if(url.pathname.startsWith('/api/'))throw new HttpError(405,'Unsupported API method or route.');
   if(req.method!=='GET'&&req.method!=='HEAD')throw new HttpError(405,'Only GET or HEAD is supported for static files.');
   const entry=FILES.get(url.pathname);if(!entry)throw new HttpError(404,'Not found.');let data;try{data=await readFile(resolve(rootDir,entry[0]));}catch{throw new HttpError(404,'Not found.');}
   res.writeHead(200,{'Content-Type':entry[1],'Content-Length':data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':CSP,'Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:data);
  }catch(error){if(!res.headersSent&&!res.destroyed)send(res,error instanceof HttpError?error.status:500,{error:error instanceof HttpError?error.message:'Local request failed.',...(Array.isArray(error.attempts)?{attempts:error.attempts}:{}),...(error.failedAttempt?{failedAttempt:error.failedAttempt}:{})},{Connection:'close'});else if(!res.destroyed)res.end();}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 let provider=null;if(process.env.THREADSCORE_ENABLE_MODEL==='1'){const {createConfiguredProvider}=await import('./src/provider.mjs');provider=createConfiguredProvider();}
 const port=Number(process.env.PORT??4173);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT.');
 createAppServer({provider}).listen(port,'127.0.0.1',()=>process.stdout.write('THREADSCORE available at http://127.0.0.1:'+port+'\n'));
}
