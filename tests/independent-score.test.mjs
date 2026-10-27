import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScore,proposeRelationshipEdit,proposeProgram,acceptProposal,acceptNoteChanges,setNoteLocks} from '../src/score.mjs';
const clone=value=>structuredClone(value);
function fixture(kind='answer',params={}){return {
 schemaVersion:1,id:'independent-score',title:'Independent score',revision:0,ppq:480,bpm:96,durationTicks:7680,
 sections:[{id:'main',startTick:0,endTick:7680}],
 motifs:[
  {id:'source-motif',name:'Source',lengthTicks:1920,notes:[{id:'s0',startTick:0,durationTicks:240,pitch:60,velocity:100},{id:'s1',startTick:480,durationTicks:240,pitch:64,velocity:80},{id:'s2',startTick:960,durationTicks:240,pitch:67,velocity:60}]},
  {id:'target-motif',name:'Target',lengthTicks:1920,notes:[{id:'t0',startTick:0,durationTicks:240,pitch:65,velocity:80},{id:'t1',startTick:480,durationTicks:480,pitch:69,velocity:80},{id:'t2',startTick:960,durationTicks:240,pitch:72,velocity:80}]}
 ],
 threads:[{id:'source-thread',name:'Source',motifId:'source-motif',channel:0,program:40},{id:'target-thread',name:'Target',motifId:'target-motif',channel:1,program:10}],
 occurrences:[{id:'source',threadId:'source-thread',sectionId:'main',startTick:0},{id:'target-a',threadId:'target-thread',sectionId:'main',startTick:1920},{id:'target-b',threadId:'target-thread',sectionId:'main',startTick:3840},{id:'untouched',threadId:'target-thread',sectionId:'main',startTick:5760}],
 relations:[{id:'relation',kind,sourceThreadId:'source-thread',targetThreadId:'target-thread',sourceOccurrenceId:'source',scopeOccurrenceIds:['target-a','target-b'],params}],locks:{},noteOverrides:{}
};}
function success(r){assert.equal(r.ok,true,JSON.stringify(r.errors));return r;}
function compiled(p){return success(compileScore(p)).score;}
function at(s,id){return s.notes.filter(n=>n.occurrenceId===id).sort((a,b)=>a.id.localeCompare(b.id));}
function byId(s,id){const n=s.notes.find(n=>n.id===id);assert.ok(n,id);return n;}
function performed(n){return Object.fromEntries(['id','startTick','durationTicks','pitch','velocity','channel','program','muted'].map(k=>[k,n[k]]));}
function hasError(r,code){assert.equal(r.ok,false);assert.ok(r.errors.some(e=>e.code===code),JSON.stringify(r.errors));}
// Expected values independently derived from the musical contract.
test('independent score: answer follows source contour into target rhythm and answers the opening',()=>{
 const n=at(compiled(fixture('answer',{interval:3,delayTicks:0,velocityScale:.5})),'target-a');
 assert.deepEqual(n.map(n=>n.pitch),[63,67,63]);assert.deepEqual(n.map(n=>[n.startTick,n.durationTicks]),[[1920,240],[2400,480],[2880,240]]);assert.deepEqual(n.map(n=>n.velocity),[40,40,40]);
});
test('independent score: shadow copies actual source timing, duration and dynamics',()=>{
 const n=at(compiled(fixture('shadow',{interval:-12,delayTicks:120,velocityScale:.5})),'target-a');
 assert.deepEqual(n.map(n=>[n.pitch,n.startTick,n.durationTicks,n.velocity]),[[48,2040,240,50],[52,2520,240,40],[55,3000,240,30]]);
});
test('independent score: inversion reflects source pitches rather than unrelated target pitches',()=>{
 const n=at(compiled(fixture('invert',{axis:60})),'target-a');assert.deepEqual(n.map(n=>n.pitch),[60,56,53]);assert.deepEqual(n.map(n=>n.startTick),[1920,2400,2880]);
});
test('independent score: interruption trims crossing notes, mutes gap and preserves exclusive endpoint',()=>{
 const p=fixture('interrupt',{sourceNoteIndex:1,gapTicks:480});p.motifs[1].notes[0].durationTicks=720;const n=at(compiled(p),'target-a');
 assert.equal(n[0].durationTicks,480);assert.equal(n[0].muted,false);assert.equal(n[1].muted,true);assert.equal(n[2].startTick,2880);assert.equal(n[2].muted,false);
});
test('independent score: full reconciliation reaches source pitch classes and ending class',()=>{
 assert.deepEqual(at(compiled(fixture('reconcile',{strength:1})),'target-a').map(n=>n.pitch),[64,67,67]);
});
test('independent score: both addressed occurrences change with exact source, unrelated notes and real ancestry',()=>{
 const p=fixture('answer',{interval:3}),snapshot=JSON.stringify(p),plain=clone(p);plain.relations=[];const original=compiled(plain),score=compiled(p);
 assert.deepEqual(at(score,'source').map(performed),at(original,'source').map(performed));assert.deepEqual(at(score,'untouched').map(performed),at(original,'untouched').map(performed));
 for(const id of ['target-a','target-b']){assert.deepEqual(at(score,id).map(n=>n.pitch),[63,67,63]);assert.ok(byId(score,id+'::t2').ancestry.some(a=>a.kind==='relation'&&a.relationId==='relation'&&a.sourceOccurrenceId==='source'&&a.targetOccurrenceId===id&&a.sourceNoteIds.includes('source::s0')));}
 assert.equal(JSON.stringify(p),snapshot);
});
test('independent score: locked performed notes survive full acceptance without collateral changes',()=>{
 const p=success(setNoteLocks(fixture('invert',{axis:60}),['target-a::t1'],true)).project,before=compiled(p);
 const accepted=success(acceptProposal(p,success(proposeRelationshipEdit(p,'relation',{params:{axis:62}})))),score=compiled(accepted.project);
 assert.deepEqual(performed(byId(score,'target-a::t1')),performed(byId(before,'target-a::t1')));assert.equal(byId(score,'target-b::t1').pitch,60);assert.deepEqual(at(score,'untouched').map(performed),at(before,'untouched').map(performed));
});
test('independent score: source locks propagate through a valid occurrence-level graph',()=>{
 const p=success(setNoteLocks(fixture('answer',{interval:3}),['source::s0'],true)).project;
 p.relations.push({id:'upstream',kind:'invert',sourceThreadId:'target-thread',targetThreadId:'source-thread',sourceOccurrenceId:'untouched',scopeOccurrenceIds:['source'],params:{axis:65}});
 const s=compiled(p);assert.equal(byId(s,'source::s0').pitch,60);assert.equal(byId(s,'source::s1').pitch,61);assert.equal(byId(s,'target-a::t0').pitch,63);assert.ok(byId(s,'target-a::t0').ancestry.some(a=>a.kind==='lock'&&a.noteId==='source::s0'));
});
test('independent score: cycles and invalid typed programs fail atomically',()=>{
 const p=fixture(),cyclic=clone(p);cyclic.relations.push({id:'back-edge',kind:'answer',sourceThreadId:'target-thread',targetThreadId:'source-thread',sourceOccurrenceId:'target-a',scopeOccurrenceIds:['source'],params:{interval:0}});
 const saved=JSON.stringify(cyclic);hasError(compileScore(cyclic),'CYCLE');assert.equal(JSON.stringify(cyclic),saved);
 const before=JSON.stringify(p);assert.equal(proposeProgram(p,{version:1,expectedRevision:p.revision,ops:[{op:'setRelation',relationId:'relation',patch:{params:{interval:7}}},{op:'setRelation',relationId:'missing-relation',patch:{params:{interval:2}}}]}).ok,false);assert.equal(JSON.stringify(p),before);
});
test('independent score: stale acceptance detects new locks and same-revision snapshot changes',()=>{
 const p=fixture('invert',{axis:60}),proposal=success(proposeRelationshipEdit(p,'relation',{params:{axis:62}}));
 hasError(acceptProposal(success(setNoteLocks(p,['target-a::t0'],true)).project,proposal),'STALE_PROPOSAL');
 const changed=clone(p);changed.threads[0].name='Renamed since preview';hasError(acceptProposal(changed,proposal),'STALE_PROPOSAL');
});
test('independent score: one accepted leaf note changes only that note and preserves relationship program',()=>{
 const p=fixture('invert',{axis:60}),before=compiled(p),proposal=success(proposeRelationshipEdit(p,'relation',{params:{axis:62}}));
 const a=success(acceptNoteChanges(p,proposal,['target-a::t0'])),s=compiled(a.project);assert.equal(byId(s,'target-a::t0').pitch,64);
 for(const n of before.notes)if(n.id!=='target-a::t0')assert.deepEqual(performed(byId(s,n.id)),performed(n),n.id);
 assert.deepEqual(a.project.relations,p.relations);assert.ok(a.project.noteOverrides['target-a::t0']);
});
test('independent score: individual acceptance cannot silently change unselected dependent notes',()=>{
 const p=fixture('answer',{interval:3});p.relations.push({id:'upstream',kind:'invert',sourceThreadId:'target-thread',targetThreadId:'source-thread',sourceOccurrenceId:'untouched',scopeOccurrenceIds:['source'],params:{axis:65}});
 const before=JSON.stringify(p),proposal=success(proposeRelationshipEdit(p,'upstream',{params:{axis:66}}));hasError(acceptNoteChanges(p,proposal,['source::s0']),'PARTIAL_DEPENDENCY');assert.equal(JSON.stringify(p),before);
});
test('independent score: forged proposal material cannot bypass typed recompilation',()=>{
 const p=fixture('invert',{axis:60}),forged=clone(success(proposeRelationshipEdit(p,'relation',{params:{axis:62}})));forged.project.relations[0].params.axis=0;if(forged.diff[0]?.after)forged.diff[0].after.pitch=200;
 const result=acceptProposal(p,forged);if(result.ok){const s=compiled(result.project);assert.equal(byId(s,'target-a::t0').pitch,64);assert.ok(s.notes.every(n=>n.pitch>=0&&n.pitch<=127));}else assert.ok(result.errors.length>0);
});
test('independent score: note bounds and duplicate identities reject without mutation',()=>{
 const p=fixture('invert',{axis:24}),before=JSON.stringify(p);hasError(compileScore(p),'NOTE_BOUNDS');assert.equal(JSON.stringify(p),before);
 const duplicate=fixture();duplicate.occurrences.push(clone(duplicate.occurrences[1]));hasError(compileScore(duplicate),'INVALID_PROJECT');
});
