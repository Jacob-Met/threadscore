import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {preflightAudio,renderPcm,encodeWav} from '../src/synth.mjs';
function scoreFixture({seconds=180,threadCount=3}={}){
 const threads=Array.from({length:threadCount},(_,i)=>({id:'thread-'+i,name:'Thread '+i,channel:i,program:0}));
 return {ppq:480,bpm:120,durationTicks:seconds*960,threads,notes:threads.map((t,i)=>({id:'note-'+i,threadId:t.id,occurrenceId:'occ-'+i,startTick:i*120,durationTicks:240,pitch:60+i,velocity:24,channel:t.channel,program:t.program,muted:false,ancestry:[]}))};
}
async function blockPcmAllocations(fn){const Native=globalThis.Float32Array;let allocations=0;globalThis.Float32Array=new Proxy(Native,{construct(){allocations++;throw Error('UNEXPECTED_PCM_ALLOCATION');}});try{const value=await fn();return {value,allocations};}finally{globalThis.Float32Array=Native;}}
test('audio budget: actual180s48k three-stem format remains supported',()=>{const p=preflightAudio(scoreFixture(),{sampleRate:48000,stemCount:3,metadataBytes:64*1024,zipEntryCount:4});assert.equal(p.frameCount,8640000);assert.equal(p.durationSeconds,180);assert.equal(p.pcmBytes,69120000);assert.equal(p.wavBytes,34560044);assert.ok(p.plannedZipBytes>=3*p.wavBytes+64*1024);assert.ok(p.plannedZipBytes<=128*1024*1024);});
test('audio budget: sparse600s96k score rejects before any PCM allocation',async()=>{const result=await blockPcmAllocations(()=>assert.throws(()=>renderPcm(scoreFixture({seconds:600,threadCount:1}),{sampleRate:96000}),/working-memory budget/i));assert.equal(result.allocations,0);});
test('audio budget: actual worker rejects excessive stems before its first render',async()=>{
 let source=await readFile(new URL('../public/audio-worker.mjs',import.meta.url),'utf8'),replacements=0;
 source=source.replace(/from\s+(['"])\/src\/(synth|zip)\.mjs\1/g,(_,quote,name)=>{replacements++;return 'from '+JSON.stringify(new URL('../src/'+name+'.mjs',import.meta.url).href);});assert.equal(replacements,2);
 const hadSelf=Object.hasOwn(globalThis,'self'),previousSelf=globalThis.self,hadPost=Object.hasOwn(globalThis,'postMessage'),previousPost=globalThis.postMessage,messages=[],workerSelf={postMessage(m){messages.push(m);}};globalThis.self=workerSelf;globalThis.postMessage=workerSelf.postMessage;
 try{await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));assert.equal(typeof workerSelf.onmessage,'function');const result=await blockPcmAllocations(()=>workerSelf.onmessage({data:{id:'independent-preflight-only',job:'stems',score:scoreFixture({seconds:180,threadCount:16}),options:{sampleRate:48000}}}));assert.equal(result.allocations,0);assert.equal(messages.length,1);assert.equal(messages[0].id,'independent-preflight-only');assert.equal(messages[0].ok,false);assert.match(messages[0].error,/stem archive budget/i);}
 finally{if(hadSelf)globalThis.self=previousSelf;else delete globalThis.self;if(hadPost)globalThis.postMessage=previousPost;else delete globalThis.postMessage;}
});
test('audio stems: shared origin and gain reproduce the mix and aligned WAV lengths',()=>{
 const score=scoreFixture({seconds:1,threadCount:2});score.notes[0].startTick=0;score.notes[0].durationTicks=480;score.notes[1].startTick=240;score.notes[1].durationTicks=480;const options={sampleRate:8000,masterGain:.1},mix=renderPcm(score,options),stems=score.threads.map(t=>renderPcm(score,{...options,threadIds:[t.id]}));assert.equal(mix.frameCount,8000);assert.equal(mix.clippedSamples,0);
 for(const stem of stems){for(const key of ['startTick','endTick','frameCount','sampleRate','masterGain','clippedSamples'])assert.equal(stem[key],mix[key]);assert.equal(encodeWav(stem).byteLength,44+mix.frameCount*4);}
 let peak=0,error=0;for(let channel=0;channel<2;channel++)for(let i=0;i<mix.frameCount;i++){const sum=stems.reduce((v,s)=>v+s.channels[channel][i],0);error=Math.max(error,Math.abs(sum-mix.channels[channel][i]));peak=Math.max(peak,Math.abs(mix.channels[channel][i]));}assert.ok(error<=1e-6);assert.ok(peak>.0001);
});
