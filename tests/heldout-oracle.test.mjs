import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoProject} from '../src/demo.mjs';
import {compileScore,proposeProgram,acceptProposal} from '../src/score.mjs';
import {buildHeldoutSuite,applyClipBaseline,performedRows,modelInputFor} from '../evaluation/heldout-v1.mjs';
function ok(result){assert.equal(result.ok,true,JSON.stringify(result.errors));return result;}
function originalFixture(){const project=createDemoProject(),score=ok(compileScore(project)).score;return {project,score,suite:buildHeldoutSuite(project,score)};}
for(const id of ['exchange-minor-third','exchange-aligned-soft-shadow','rupture-first-note-gap']){
 test('held-out oracle only: gold '+id+' matches independent flat-clip edits',()=>{
  const {project,score,suite}=originalFixture(),before=JSON.stringify(project),task=suite.cases.find(c=>c.id===id);
  assert.ok(task);assert.equal(task.qualificationStatus,'NOT_RUN');
  assert.deepEqual(applyClipBaseline(suite.baselineRows,task.clipPlan,suite.pinIds),task.expectedRows,'flat clip comparator must reproduce the independent musical oracle');
  const proposal=ok(proposeProgram(project,task.goldProgram)),accepted=ok(acceptProposal(project,proposal)),result=ok(compileScore(accepted.project)).score;
  assert.deepEqual(performedRows(result),task.expectedRows,'compare all576 notes, including untouched and muted notes');
  assert.deepEqual(accepted.project.relations,task.expectedRelations);
  for(const key of ['id','title','ppq','bpm','durationTicks','motifs','threads','sections','occurrences','locks','noteOverrides'])assert.deepEqual(accepted.project[key],project[key],'unexpected '+key+' mutation');
  for(const pinId of suite.pinIds){
   const originalPin=score.notes.find(n=>n.id===pinId),acceptedPin=result.notes.find(n=>n.id===pinId);
   assert.deepEqual(performedRows({notes:[acceptedPin]}),performedRows({notes:[originalPin]}));assert.deepEqual(acceptedPin.ancestry,originalPin.ancestry,'pin must keep its saved ancestry');
  }
  for(const check of task.lineageChecks){
   const note=result.notes.find(n=>n.id===check.noteId);assert.ok(note);
   assert.ok(note.ancestry.some(entry=>entry.kind==='relation'&&entry.relationId===check.relationId&&entry.targetOccurrenceId===note.occurrenceId&&entry.sourceNoteIds.includes(check.sourceNoteId)),'missing actual source lineage for '+check.noteId);
  }
  assert.equal(JSON.stringify(project),before,'fixture/oracle/proposal evaluation must leave original project untouched');
 });
}
test('held-out packaging: model payload excludes gold answers, expected notes and baseline edits',()=>{
 const {project,suite}=originalFixture();
 for(const task of suite.cases){const payload=modelInputFor(task,project);assert.deepEqual(Object.keys(payload).sort(),['brief','project']);assert.equal(payload.brief,task.prompt);assert.deepEqual(payload.project,project);assert.notEqual(payload.project,project);assert.equal(payload.goldProgram,undefined);assert.equal(payload.expectedRows,undefined);assert.equal(payload.clipPlan,undefined);assert.equal(task.qualificationStatus,'NOT_RUN');}
});
