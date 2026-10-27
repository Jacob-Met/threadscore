import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScore} from '../src/score.mjs';
function repeatedRelations(count){return {
 schemaVersion:1,id:'ancestry-work',title:'Ancestry work control',revision:0,ppq:480,bpm:96,durationTicks:1536,sections:[{id:'section',startTick:0,endTick:1536}],
 motifs:[{id:'source-motif',name:'Source',lengthTicks:512,notes:[{id:'source-note',startTick:0,durationTicks:1,pitch:60,velocity:80}]},{id:'target-motif',name:'Target',lengthTicks:512,notes:Array.from({length:256},(_,i)=>({id:'target-note-'+i,startTick:i*2,durationTicks:1,pitch:61,velocity:80}))}],
 threads:[{id:'source-thread',name:'Source',motifId:'source-motif',channel:0,program:0},{id:'target-thread',name:'Target',motifId:'target-motif',channel:1,program:0}],
 occurrences:[{id:'source-occurrence',threadId:'source-thread',sectionId:'section',startTick:0},{id:'target-occurrence',threadId:'target-thread',sectionId:'section',startTick:512}],
 relations:Array.from({length:count},(_,i)=>({id:'relation-'+i,kind:'answer',sourceThreadId:'source-thread',targetThreadId:'target-thread',sourceOccurrenceId:'source-occurrence',scopeOccurrenceIds:['target-occurrence'],params:{interval:0,delayTicks:0,velocityScale:1}})),locks:{},noteOverrides:{}
};}
test('ancestry work: ordinary causal transformation still compiles into actual notes',()=>{const result=compileScore(repeatedRelations(8));assert.equal(result.ok,true,JSON.stringify(result.errors));assert.equal(result.score.notes.length,257);const target=result.score.notes.filter(n=>n.occurrenceId==='target-occurrence');assert.equal(target.length,256);assert.ok(target.every(n=>n.pitch===60));});
test('ancestry work: repeated legal relations cannot bypass the cumulative budget',()=>{const project=repeatedRelations(128),before=JSON.stringify(project),result=compileScore(project);assert.equal(result.ok,false);assert.ok(result.errors.some(e=>e.code==='COMPLEXITY_LIMIT'&&/ancestry.*work/i.test(e.message)),JSON.stringify(result.errors));assert.equal(JSON.stringify(project),before);assert.equal(result.score,undefined);});
