// Live check: one real Nemotron call on Nebius Token Factory. Needs NEBIUS_API_KEY; prints no secrets.
import {createConfiguredProvider} from '../src/provider.mjs';
import {createDemoProject} from '../src/demo.mjs';
const provider=createConfiguredProvider({env:{...process.env,THREADSCORE_ENABLE_MODEL:'1'},attemptTimeoutMs:20000});
if(!provider.available){console.error('No NEBIUS_API_KEY set.');process.exit(2);}
const instruction=process.argv[2]??'Let the answer respond a major third higher, and make it softer.';
const started=Date.now();
try{const r=await provider.propose({project:createDemoProject(),instruction});
 console.log(JSON.stringify({model:r.evidence.model,received:r.evidence.receivedModel,requestId:r.evidence.requestId,latencyMs:Math.round(r.evidence.latencyMs),usage:r.evidence.usage,attempts:r.attempts.map(a=>a.validation),ops:r.program.ops?.length??null},null,1));}
catch(e){console.error('FAILED',e.code,e.message,JSON.stringify(e.attempts?.map(a=>a.validation)),Date.now()-started,'ms');process.exit(1);}
