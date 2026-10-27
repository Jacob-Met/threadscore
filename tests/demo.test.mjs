import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoProject} from '../src/demo.mjs';
import {compileScore,proposeRelationshipEdit,proposeProgram,acceptProposal} from '../src/score.mjs';
const noteState=n=>({id:n.id,startTick:n.startTick,durationTicks:n.durationTicks,pitch:n.pitch,velocity:n.velocity,muted:n.muted,channel:n.channel,program:n.program});
const noteMap=s=>new Map(s.notes.map(n=>[n.id,n]));
function compiled(p){const r=compileScore(p);assert.equal(r.ok,true,JSON.stringify(r.errors));return r.score;}
test('original demo has a real three-minute timeline, three motifs and persistent scoped relations',()=>{
 const p=createDemoProject(),s=compiled(p);assert.equal(s.durationTicks/s.ppq*60/s.bpm,180);assert.equal(p.motifs.length,3);assert.equal(p.threads.length,3);assert.equal(p.sections.length,6);assert.equal(p.occurrences.length,108);assert.equal(s.notes.length,576);assert.equal(new Set(s.notes.map(n=>n.id)).size,576);assert.equal(p.relations.length,6);assert.equal(new Set(p.relations.map(r=>r.kind)).size,6);for(const r of p.relations)assert.equal(r.scopeOccurrenceIds.length,3);
 const last=Math.max(...s.notes.filter(n=>!n.muted).map(n=>n.startTick+n.durationTicks));assert.equal(last/s.ppq*60/s.bpm,179.6875);assert.ok(s.notes.filter(n=>!n.muted).length>560);assert.equal(p.evaluation.listeningValidated,false);assert.equal(p.evaluation.independentClipComparisonValidated,false);
});
test('all six demo relations materially transform each addressed occurrence',()=>{
 const p=createDemoProject(),withAll=compiled(p),all=noteMap(withAll);for(const r of p.relations){const plain=compiled({...p,relations:p.relations.filter(x=>x.id!==r.id)});assert.deepEqual(plain.notes.map(n=>n.id).sort(),withAll.notes.map(n=>n.id).sort());for(const id of r.scopeOccurrenceIds)assert.ok(plain.notes.filter(n=>n.occurrenceId===id).some(n=>JSON.stringify(noteState(n))!==JSON.stringify(noteState(all.get(n.id)))),r.id+' materially changes '+id);}
});
test('answer edit propagates through shadow preserving its pinned note and unrelated passages',()=>{
 const p=createDemoProject(),unchanged=structuredClone(p),before=compiled(p),beforeIds=noteMap(before),proposal=proposeRelationshipEdit(p,'answer-exchange',{params:{interval:4}});
 assert.equal(proposal.ok,true,JSON.stringify(proposal.errors));assert.deepEqual(p,unchanged);const expected=['exchange-glass-1','exchange-glass-3','exchange-glass-5','exchange-ground-1','exchange-ground-3','exchange-ground-5'];assert.deepEqual([...proposal.affectedOccurrenceIds].sort(),[...expected].sort());assert.equal(proposal.diff.length,26);const after=noteMap(proposal.score);assert.deepEqual(after.get('exchange-glass-1::b1'),beforeIds.get('exchange-glass-1::b1'));
 for(const n of before.notes)if(!expected.includes(n.occurrenceId))assert.deepEqual(after.get(n.id),n,n.id);for(const id of ['exchange-ground-1','exchange-ground-3','exchange-ground-5'])assert.ok(proposal.diff.some(d=>d.after.occurrenceId===id));
 const descendant=after.get('exchange-ground-1::c2');assert.ok(descendant.ancestry.some(e=>e.kind==='relation'&&e.relationId==='answer-exchange'&&e.parameters.interval===4));assert.ok(descendant.ancestry.some(e=>e.kind==='relation'&&e.relationId==='shadow-exchange'&&e.sourceNoteIds.includes('exchange-glass-1::b2')));
 const accepted=acceptProposal(p,proposal);assert.equal(accepted.ok,true,JSON.stringify(accepted.errors));assert.equal(accepted.project.revision,p.revision+1);assert.deepEqual(p,unchanged);assert.deepEqual(accepted.score.notes,proposal.score.notes);
});
test('typed program cannot repair demo pitch violations by clipping',()=>{
 const p=createDemoProject(),before=structuredClone(p),proposal=proposeProgram(p,{version:1,expectedRevision:p.revision,ops:[{op:'setRelation',relationId:'invert-mirror',patch:{params:{axis:96}}}]});assert.equal(proposal.ok,false);assert.ok(proposal.errors.some(e=>e.code==='NOTE_BOUNDS'));assert.deepEqual(p,before);
});
