import {compileScore} from './score.mjs';
const FORMAT='threadscore-project',VERSION=1,MAX_BYTES=2*1024*1024,encoder=new TextEncoder(),forbiddenKeys=new Set(['__proto__','prototype','constructor']);
const fail=message=>{throw Error('THREADSCORE project: '+message);};
function canonicalClone(value){
 let nodes=0,stringUnits=0;
 function visit(item,depth){
  if(++nodes>100000||depth>16)fail('document exceeds structural limits');
  if(item===null||typeof item==='boolean')return item;
  if(typeof item==='number'){if(!Number.isFinite(item))fail('non-finite numbers are not allowed');return Object.is(item,-0)?0:item;}
  if(typeof item==='string'){stringUnits+=item.length;if(item.length>16384||stringUnits>MAX_BYTES)fail('text exceeds supported limits');return item;}
  if(Array.isArray(item)){if(item.length>4096)fail('array exceeds supported length');if(Object.getOwnPropertySymbols(item).length||Object.getOwnPropertyNames(item).length!==item.length+1)fail('sparse or decorated arrays are not JSON data');const output=[];for(let index=0;index<item.length;index++){const descriptor=Object.getOwnPropertyDescriptor(item,String(index));if(!descriptor||!('value'in descriptor))fail('sparse or accessor arrays are not JSON data');output.push(visit(descriptor.value,depth+1));}return output;}
  if(typeof item!=='object'||(Object.getPrototypeOf(item)!==Object.prototype&&Object.getPrototypeOf(item)!==null))fail('only plain JSON data is allowed');
  if(Object.getOwnPropertySymbols(item).length)fail('symbol keys are not JSON data');
  const keys=Object.keys(item).sort();if(keys.length>20000)fail('object exceeds supported field count');const output={};
  for(const key of keys){if(forbiddenKeys.has(key)||key.length>256)fail('unsafe or oversized object key');stringUnits+=key.length;if(stringUnits>MAX_BYTES)fail('text exceeds supported limits');const descriptor=Object.getOwnPropertyDescriptor(item,key);if(!descriptor||!('value'in descriptor))fail('accessor properties are not JSON data');output[key]=visit(descriptor.value,depth+1);}
  return output;
 }
 return visit(value,0);
}
function boundedStringify(value){const text=JSON.stringify(value);if(text.length>MAX_BYTES||encoder.encode(text).length>MAX_BYTES)fail('document exceeds 2 MiB');return text;}
function boundedArray(project,name,maximum){if(!Array.isArray(project[name])||project[name].length>maximum)fail(name+' must contain at most '+maximum+' entries');}
function validateProjectShape(project){
 if(!project||typeof project!=='object'||Array.isArray(project))fail('project must be an object');
 if(project.schemaVersion!==1)fail('unsupported project schema version');if(project.ppq!==480)fail('this project version requires PPQ 480');if(!Number.isFinite(project.bpm)||project.bpm<30||project.bpm>240)fail('BPM must be from 30 to 240');
 if(!Number.isSafeInteger(project.durationTicks)||project.durationTicks<=0||project.durationTicks>480*4*3600)fail('duration exceeds supported tick bounds');
 if(!Number.isSafeInteger(project.revision)||project.revision<0)fail('revision must be a nonnegative safe integer');
 if(typeof project.id!=='string'||!project.id||project.id.length>256)fail('invalid project id');if(typeof project.title!=='string'||project.title.length>256)fail('invalid project title');
 for(const [name,maximum]of [['sections',128],['motifs',64],['threads',16],['occurrences',1024],['relations',128]])boundedArray(project,name,maximum);
 for(const motif of project.motifs)if(!motif||!Array.isArray(motif.notes)||motif.notes.length<1||motif.notes.length>256)fail('each motif requires 1–256 notes');
 for(const name of ['locks','noteOverrides']){const value=project[name];if(value!==undefined&&(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>20000))fail('invalid '+name+' map');}
 if('score'in project||'compiledScore'in project)fail('cached scores are not project source');
}
function compileChecked(project,canonicalText){
 let result;try{result=compileScore(project);}catch(error){fail('compilation failed: '+String(error?.message??error).slice(0,512));}
 if(!result?.ok||!result.score){const errors=Array.isArray(result?.errors)?result.errors.slice(0,4).map(error=>typeof error==='string'?error:error?.message??error?.code??'invalid project').join('; '):'invalid project';fail('compilation rejected project: '+errors);}
 if(JSON.stringify(project)!==canonicalText)fail('compiler mutated the stored project snapshot');return result.score;
}
async function sha256(text){if(!globalThis.crypto?.subtle)fail('SHA-256 is unavailable in this environment');const digest=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',encoder.encode(text)));return Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('');}
function evidenceReceipt(value,imported,allowAttempts=true){
 if(value===null||value===undefined)return null;if(!value||typeof value!=='object'||Array.isArray(value))fail('model evidence must be an object or null');const output={};
 for(const key of ['provider','model','receivedModel','requestId','owner','operationId','tool','receiptId','createdAt','role'])if(value[key]!==undefined){if(typeof value[key]!=='string'||value[key].length>(key==='role'?2048:512))fail('invalid model evidence '+key);output[key]=value[key];}
 if(value.latencyMs!==undefined){if(!Number.isFinite(value.latencyMs)||value.latencyMs<0||value.latencyMs>86400000)fail('invalid model latency');output.latencyMs=value.latencyMs;}
 if(value.audioSent!==undefined){if(typeof value.audioSent!=='boolean')fail('invalid audioSent receipt');output.audioSent=value.audioSent;}
 if(value.usage!==undefined&&value.usage!==null){if(typeof value.usage!=='object'||Array.isArray(value.usage))fail('invalid model usage');output.usage={};for(const key of ['prompt_tokens','completion_tokens','total_tokens'])if(value.usage[key]!==undefined){const count=value.usage[key];if(!Number.isSafeInteger(count)||count<0||count>1000000000)fail('invalid token usage');output.usage[key]=count;}}
 if(value.cost!==undefined){if(value.cost!==null&&(!Number.isFinite(value.cost)||value.cost<0||value.cost>1000000))fail('invalid recorded cost');output.cost=value.cost;}
 if(value.attempts!==undefined){
  if(!allowAttempts)fail('nested model attempt receipts are not supported');
  if(!Array.isArray(value.attempts)||value.attempts.length<1||value.attempts.length>2)fail('model evidence supports one or two attempt receipts');
  output.attempts=value.attempts.map((attempt,index)=>{
   if(!attempt||typeof attempt!=='object'||Array.isArray(attempt)||attempt.attempt!==index+1||!['accepted','rejected'].includes(attempt.validation)||!attempt.evidence)fail('invalid model attempt receipt');
   return {attempt:index+1,validation:attempt.validation,evidence:evidenceReceipt(attempt.evidence,imported,false)};
  });
 }
 output.evidenceOrigin=imported?'imported_unverified':value.evidenceOrigin==='live_receipt_this_session'?'live_receipt_this_session':value.evidenceOrigin==='imported_unverified'?'imported_unverified':'unverified';
 return output;
}
export async function encodeProject(project,{modelEvidence=null}={}){
 const snapshot=canonicalClone(project);validateProjectShape(snapshot);const canonicalText=boundedStringify(snapshot);compileChecked(snapshot,canonicalText);
 const receipt=evidenceReceipt(canonicalClone(modelEvidence),false),value={format:FORMAT,version:VERSION,project:snapshot,checksum:await sha256(canonicalText),modelEvidence:receipt};boundedStringify(value);return value;
}
export async function decodeProject(value){
 const document=canonicalClone(value);boundedStringify(document);if(!document||Array.isArray(document)||typeof document!=='object')fail('document must be an object');
 if(document.format!==FORMAT||document.version!==VERSION)fail('unsupported project file format or version');for(const key of Object.keys(document))if(!['format','version','project','checksum','modelEvidence'].includes(key))fail('unexpected document field '+key);
 if(typeof document.checksum!=='string'||!/^[0-9a-f]{64}$/.test(document.checksum))fail('invalid SHA-256 checksum');
 validateProjectShape(document.project);const canonicalText=boundedStringify(document.project),expectedChecksum=await sha256(canonicalText);if(expectedChecksum!==document.checksum)fail('checksum mismatch; project content changed or is corrupted');
 const score=compileChecked(document.project,canonicalText),modelEvidence=evidenceReceipt(document.modelEvidence,true);return {project:document.project,modelEvidence,score};
}
