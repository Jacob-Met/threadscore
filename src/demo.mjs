import {compileScore} from './score.mjs';
export const DEMO_BPM=96,DEMO_SECONDS=180;
export function createDemoProject(){
 const phrase=3840,sectionLength=23040;
 const specs=[['opening','Opening'],['exchange','Exchange'],['mirror','Mirror'],['rupture','Interruption'],['meeting','Reconciliation'],['departure','Departure']];
 const sections=specs.map(([id,name],index)=>({id,name,startTick:index*sectionLength,endTick:(index+1)*sectionLength}));
 const notes=(prefix,rows)=>rows.map(([startTick,durationTicks,pitch,velocity],i)=>({id:prefix+(i+1),startTick,durationTicks,pitch,velocity}));
 const motifs=[
 {id:'motif-ember',name:'Ember',lengthTicks:phrase,notes:notes('a',[[0,480,60,86],[480,240,63,72],[960,480,67,94],[1680,240,65,68],[2160,480,62,80],[2880,720,60,74]])},
 {id:'motif-glass',name:'Glass',lengthTicks:phrase,notes:notes('b',[[0,720,55,67],[960,480,59,76],[1680,240,62,88],[2160,480,64,80],[2880,480,59,72],[3360,240,55,61]])},
 {id:'motif-ground',name:'Ground',lengthTicks:phrase,notes:notes('c',[[0,960,36,78],[1440,480,43,66],[2400,480,40,72],[3120,480,38,62]])}
 ];
 const threads=[{id:'ember',name:'Ember',motifId:'motif-ember',channel:0,program:0},{id:'glass',name:'Glass',motifId:'motif-glass',channel:1,program:11},{id:'ground',name:'Ground',motifId:'motif-ground',channel:2,program:32}];
 const transpose={ember:[0,2,-2,0,5,0],glass:[0,0,0,-2,0,2],ground:[0,0,0,0,0,0]},occurrences=[];
 sections.forEach((section,si)=>{for(const thread of threads)for(let slot=0;slot<6;slot++)occurrences.push({id:section.id+'-'+thread.id+'-'+(slot+1),threadId:thread.id,sectionId:section.id,startTick:section.startTick+slot*phrase,transpose:transpose[thread.id][si]});});
 const scope=(section,thread)=>[1,3,5].map(slot=>section+'-'+thread+'-'+slot);
 const relations=[
 {id:'answer-exchange',kind:'answer',sourceThreadId:'ember',targetThreadId:'glass',sourceOccurrenceId:'exchange-ember-1',scopeOccurrenceIds:scope('exchange','glass'),params:{interval:3,delayTicks:0,velocityScale:.9}},
 {id:'shadow-exchange',kind:'shadow',sourceThreadId:'glass',targetThreadId:'ground',sourceOccurrenceId:'exchange-glass-1',scopeOccurrenceIds:scope('exchange','ground'),params:{interval:-12,delayTicks:120,velocityScale:.6}},
 {id:'invert-mirror',kind:'invert',sourceThreadId:'ember',targetThreadId:'glass',sourceOccurrenceId:'mirror-ember-1',scopeOccurrenceIds:scope('mirror','glass'),params:{axis:60}},
 {id:'interrupt-rupture',kind:'interrupt',sourceThreadId:'glass',targetThreadId:'ember',sourceOccurrenceId:'rupture-glass-1',scopeOccurrenceIds:scope('rupture','ember'),params:{sourceNoteIndex:2,gapTicks:480}},
 {id:'reconcile-meeting',kind:'reconcile',sourceThreadId:'ember',targetThreadId:'glass',sourceOccurrenceId:'meeting-ember-1',scopeOccurrenceIds:scope('meeting','glass'),params:{strength:.75}},
 {id:'diverge-departure',kind:'gradualDiverge',sourceThreadId:'ember',targetThreadId:'glass',sourceOccurrenceId:'departure-ember-1',scopeOccurrenceIds:scope('departure','glass'),params:{semitones:4,driftTicks:120}}
 ];
 const project={schemaVersion:1,id:'threadscore-original-demo',title:'Three threads, six rooms',revision:0,ppq:480,bpm:DEMO_BPM,durationTicks:6*sectionLength,sections,motifs,threads,occurrences,relations,locks:{},noteOverrides:{},authorship:{kind:'original-symbolic-demo',description:'Three newly authored short MIDI motifs and a deterministic relationship score for instrument testing.'},evaluation:{listeningValidated:false,independentClipComparisonValidated:false}};
 const compiled=compileScore(project);if(!compiled.ok)throw Error('Original demo did not compile: '+JSON.stringify(compiled.errors));
 const locked=compiled.score.notes.find(n=>n.id==='exchange-glass-1::b1');project.locks[locked.id]={startTick:locked.startTick,durationTicks:locked.durationTicks,pitch:locked.pitch,velocity:locked.velocity,muted:locked.muted,ancestry:structuredClone(locked.ancestry)};
 return project;
}
