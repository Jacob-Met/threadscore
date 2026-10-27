import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeProject,decodeProject} from '../src/project.mjs';
import {compileScore} from '../src/score.mjs';
function fixture(){return{
 schemaVersion:1,id:'custody-fixture',title:'Independent symbolic custody fixture',revision:3,ppq:480,bpm:120,durationTicks:7680,
 sections:[{id:'s1',startTick:0,endTick:3840},{id:'s2',startTick:3840,endTick:7680}],
 motifs:[
 {id:'ma',name:'A',lengthTicks:1920,notes:[{id:'a1',startTick:0,durationTicks:480,pitch:60,velocity:84},{id:'a2',startTick:960,durationTicks:480,pitch:64,velocity:76}]},
 {id:'mb',name:'B',lengthTicks:1920,notes:[{id:'b1',startTick:240,durationTicks:480,pitch:67,velocity:72},{id:'b2',startTick:1200,durationTicks:480,pitch:69,velocity:80}]},
 {id:'mc',name:'C',lengthTicks:1920,notes:[{id:'c1',startTick:0,durationTicks:960,pitch:48,velocity:66},{id:'c2',startTick:960,durationTicks:720,pitch:55,velocity:70}]}],
 threads:[{id:'ta',name:'Thread A',motifId:'ma',channel:0,program:0},{id:'tb',name:'Thread B',motifId:'mb',channel:1,program:40},{id:'tc',name:'Thread C',motifId:'mc',channel:2,program:48}],
 occurrences:[{id:'a-one',threadId:'ta',sectionId:'s1',startTick:0},{id:'b-one',threadId:'tb',sectionId:'s1',startTick:1920},{id:'c-one',threadId:'tc',sectionId:'s1',startTick:0},{id:'a-two',threadId:'ta',sectionId:'s2',startTick:3840},{id:'b-two',threadId:'tb',sectionId:'s2',startTick:5760},{id:'c-two',threadId:'tc',sectionId:'s2',startTick:3840}],
 relations:[],locks:{'a-one::a1':{startTick:0,durationTicks:480,pitch:60,velocity:84,muted:false,ancestry:[{kind:'fixture-pin',sourceNoteId:'a1'}]}},noteOverrides:{'b-two::b1':{note:{startTick:6000,durationTicks:480,pitch:71,velocity:74,muted:false},ancestry:[{kind:'fixture-edit',sourceNoteId:'b1',fromNoteId:'b-two::b1'}]}}
};}
function ordered(v,reverse=false){if(Array.isArray(v))return v.map(x=>ordered(x,reverse));if(v&&typeof v==='object'){const keys=Object.keys(v).sort();if(reverse)keys.reverse();return Object.fromEntries(keys.map(k=>[k,ordered(v[k],reverse)]));}return v;}
async function resign(d){const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(ordered(d.project)))));d.checksum=Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');return d;}
test('custody roundtrip recompiles actual notes and preserves locks and override ancestry',async()=>{
 const source=fixture(),before=structuredClone(source),compiled=compileScore(source);assert.equal(compiled.ok,true,JSON.stringify(compiled.errors));
 const encoded=await encodeProject(source);assert.equal(encoded.format,'threadscore-project');assert.equal(encoded.version,1);assert.match(encoded.checksum,/^[0-9a-f]{64}$/);assert.equal('score'in encoded,false);
 const loaded=await decodeProject(JSON.parse(JSON.stringify(encoded)));assert.deepEqual(loaded.project,source);assert.deepEqual(source,before);assert.deepEqual(loaded.score,compiled.score);assert.equal(loaded.score.notes.length,12);
 const n=loaded.score.notes.find(n=>n.id==='b-two::b1');assert.equal(n.pitch,71);assert.equal(n.velocity,74);assert.equal(n.startTick,6000);const pin=loaded.score.notes.find(n=>n.id==='a-one::a1');assert.equal(pin.pitch,60);assert.equal(pin.startTick,0);assert.equal(loaded.modelEvidence,null);
});
test('canonical checksum ignores object key ordering and binds actual note values',async()=>{
 const first=await encodeProject(fixture()),reordered=await encodeProject(ordered(fixture(),true));assert.equal(first.checksum,reordered.checksum);const changed=fixture();changed.motifs[2].notes[0].velocity++;assert.notEqual(first.checksum,(await encodeProject(changed)).checksum);
});
test('changed content cannot pass the original checksum',async()=>{const v=await encodeProject(fixture());v.project.motifs[2].notes[0].pitch++;await assert.rejects(()=>decodeProject(v),/checksum mismatch/i);});
test('recomputed checksum cannot authorize an invalid MIDI program',async()=>{const v=await encodeProject(fixture());v.project.threads[0].program=128;await resign(v);await assert.rejects(()=>decodeProject(v),/compilation rejected|program/i);});
test('recomputed checksum cannot bypass relationship-cycle rejection',async()=>{
 const v=await encodeProject(fixture());v.project.relations=[{id:'ab',kind:'shadow',sourceThreadId:'ta',targetThreadId:'tb',sourceOccurrenceId:'a-one',scopeOccurrenceIds:['b-one'],params:{}},{id:'ba',kind:'shadow',sourceThreadId:'tb',targetThreadId:'ta',sourceOccurrenceId:'b-one',scopeOccurrenceIds:['a-one'],params:{}}];await resign(v);await assert.rejects(()=>decodeProject(v),/compilation rejected|cycle/i);
});
test('imported receipts are informational and ordinary resave cannot promote them',async()=>{
 const evidence={provider:'fixture-provider',model:'requested-model',receivedModel:'returned-model',requestId:'fixture-request',latencyMs:21.5,usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15},audioSent:false,role:'Text instruction interpretation, not an acoustic measurement',evidenceOrigin:'live_receipt_this_session',ignoredNestedPayload:{unsafeToTreatAsProof:true}};
 const encoded=await encodeProject(fixture(),{modelEvidence:evidence});assert.equal(encoded.modelEvidence.evidenceOrigin,'live_receipt_this_session');assert.equal('ignoredNestedPayload'in encoded.modelEvidence,false);
 const loaded=await decodeProject(encoded);assert.equal(loaded.modelEvidence.evidenceOrigin,'imported_unverified');assert.equal(loaded.modelEvidence.audioSent,false);assert.equal(loaded.modelEvidence.receivedModel,'returned-model');assert.deepEqual(loaded.modelEvidence.usage,evidence.usage);
 assert.equal((await encodeProject(loaded.project,{modelEvidence:loaded.modelEvidence})).modelEvidence.evidenceOrigin,'imported_unverified');
});
test('oversized motifs, collections and documents reject before compilation',async()=>{
 const n=fixture();n.motifs[0].notes=Array.from({length:257},(_,i)=>({id:'n'+i,startTick:0,durationTicks:1,pitch:60,velocity:80}));await assert.rejects(()=>encodeProject(n),/256/);
 const o=fixture();o.occurrences=Array.from({length:1025},(_,i)=>({id:'o'+i,threadId:'ta',sectionId:'s1',startTick:0}));await assert.rejects(()=>encodeProject(o),/1024/);
 const huge=fixture();huge.extra=Array.from({length:2050},()=>'x'.repeat(1024));await assert.rejects(()=>encodeProject(huge),/limit|2 MiB/);
});
test('unsafe keys, object and array accessors, nonfinite numbers and cached scores reject',async()=>{
 const unsafe=fixture();unsafe.extra=JSON.parse('{"__proto__":{"polluted":true}}');await assert.rejects(()=>encodeProject(unsafe),/unsafe/);assert.equal({}.polluted,undefined);
 const accessor=fixture();let read=false;Object.defineProperty(accessor,'title',{enumerable:true,get(){read=true;return 'unexpected';}});await assert.rejects(()=>encodeProject(accessor),/accessor/);assert.equal(read,false);
 const array=fixture();let arrayRead=false;Object.defineProperty(array.motifs[0].notes,'0',{enumerable:true,configurable:true,get(){arrayRead=true;return {};}});await assert.rejects(()=>encodeProject(array),/accessor/);assert.equal(arrayRead,false);
 const sparse=fixture();delete sparse.motifs[0].notes[0];await assert.rejects(()=>encodeProject(sparse),/sparse/);
 const n=fixture();n.motifs[0].notes[0].velocity=Infinity;await assert.rejects(()=>encodeProject(n),/non-finite/);const c=fixture();c.compiledScore={notes:[]};await assert.rejects(()=>encodeProject(c),/cached scores/);
});
test('unsupported versions, unexpected cached data and malformed checksums fail closed',async()=>{
 const v=await encodeProject(fixture());v.version=2;await assert.rejects(()=>decodeProject(v),/version/);const extra=await encodeProject(fixture());extra.score={notes:[]};await assert.rejects(()=>decodeProject(extra),/unexpected/);const hash=await encodeProject(fixture());hash.checksum='not-a-hash';await assert.rejects(()=>decodeProject(hash),/checksum/);
});
