const clone=value=>structuredClone(value);
const fields=['startTick','durationTicks','pitch','velocity','channel','program','muted'];
const answerScopes=[1,3,5].map(i=>'exchange-glass-'+i);
const shadowScopes=[1,3,5].map(i=>'exchange-ground-'+i);
const interruptScopes=[1,3,5].map(i=>'rupture-ember-'+i);
const pinId='exchange-glass-1::b1';
const ensure=(condition,message)=>{if(!condition)throw new Error('Held-out fixture: '+message);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function performedRows(score){
 return score.notes.map(n=>Object.fromEntries(['id','threadId','occurrenceId',...fields].map(k=>[k,n[k]]))).sort((a,b)=>a.id.localeCompare(b.id));
}
function ordered(rows,occurrenceId){return rows.filter(n=>n.occurrenceId===occurrenceId).sort((a,b)=>a.startTick-b.startTick||a.id.localeCompare(b.id));}
export function buildHeldoutSuite(project,originalScore){
 ensure(project.title==='Three threads, six rooms'&&project.revision===0,'reset to the original demo');
 ensure(project.ppq===480&&project.bpm===96&&project.durationTicks===138240,'clock differs');
 ensure(project.motifs.length===3&&project.occurrences.length===108&&project.sections.length===6,'structure differs');
 ensure(originalScore.notes.length===576&&originalScore.notes.filter(n=>!n.muted).length===573,'original note inventory differs');
 ensure(equal(Object.keys(project.locks).sort(),[pinId]),'original pin set differs');
 ensure(Object.keys(project.noteOverrides).length===0,'original demo must not contain accepted edit overrides');
 const rows=performedRows(originalScore),byId=new Map(rows.map(n=>[n.id,n]));
 const relation=id=>{const r=project.relations.find(r=>r.id===id);ensure(r,'missing '+id);return r;};
 ensure(equal(answerScopes,relation('answer-exchange').scopeOccurrenceIds),'answer scope differs');
 ensure(equal(shadowScopes,relation('shadow-exchange').scopeOccurrenceIds),'shadow scope differs');
 ensure(equal(interruptScopes,relation('interrupt-rupture').scopeOccurrenceIds),'interrupt scope differs');
 ensure(relation('answer-exchange').params.interval===3,'answer interval is no longer original');
 ensure(relation('shadow-exchange').params.delayTicks===120&&relation('shadow-exchange').params.velocityScale===0.6&&relation('shadow-exchange').params.interval===-12,'shadow parameters differ');
 ensure(relation('interrupt-rupture').params.sourceNoteIndex===2&&relation('interrupt-rupture').params.gapTicks===480,'interrupt parameters differ');
 const glassSource=ordered(rows,'exchange-glass-1'),sourceIndices=[0,1,3,4];
 ensure(glassSource.length===6,'shadow source cardinality differs');
 ensure(equal(sourceIndices.map(i=>glassSource[i].velocity),[60,68,72,65]),'frozen source velocities differ');
 for(const id of shadowScopes)ensure(equal(ordered(rows,id).map(n=>n.velocity),[36,41,43,39]),'baseline shadow velocities differ in '+id);
 function makeCase(id,prompt,relationId,patch,edit,expectedCounts,lineageChecks){
  const expected=new Map(rows.map(n=>[n.id,clone(n)]));edit(expected);
  const expectedRows=[...expected.values()].sort((a,b)=>a.id.localeCompare(b.id)),grouped=new Map();let changedFields=0;
  for(const after of expectedRows){
   const before=byId.get(after.id),changed=fields.filter(k=>before[k]!==after[k]);if(!changed.length)continue;
   ensure(after.id!==pinId,'oracle attempted to change the pinned note');changedFields+=changed.length;
   if(!grouped.has(after.occurrenceId))grouped.set(after.occurrenceId,[]);
   grouped.get(after.occurrenceId).push({noteId:after.id,before:clone(before),after:clone(after),changedFields:changed});
  }
  const clipPlan=[...grouped].map(([occurrenceId,changes])=>({occurrenceId,changes})).sort((a,b)=>a.occurrenceId.localeCompare(b.occurrenceId));
  const counts={clips:clipPlan.length,notes:clipPlan.reduce((n,clip)=>n+clip.changes.length,0),fields:changedFields};
  ensure(equal(counts,expectedCounts),id+' change inventory differs: '+JSON.stringify(counts));
  const expectedRelations=clone(project.relations),changedRelation=expectedRelations.find(r=>r.id===relationId);
  changedRelation.params={...changedRelation.params,...patch.params};
  return {id,prompt,goldProgram:{version:1,expectedRevision:0,ops:[{op:'setRelation',relationId,patch}]},expectedRows,expectedRelations,clipPlan,counts,lineageChecks,qualificationStatus:'NOT_RUN',unmeasured:['human editing effort','musical quality','blinded listening preference','live model reliability']};
 }
 const answerLineage=shadowScopes.flatMap(id=>ordered(rows,id).map((n,i)=>({noteId:n.id,relationId:'shadow-exchange',sourceNoteId:glassSource[sourceIndices[i]].id})));
 const answer=makeCase('exchange-minor-third',
  'In Exchange, move the existing Glass answers up a minor third. Let their Ground shadows follow the changed source. Keep timing, note lengths, and MIDI velocities as they are. Preserve the pinned first note of exchange-glass-1, leave Ember source phrases unchanged, and change no unrelated occurrences or other sections.',
  'answer-exchange',{params:{interval:6}},expected=>{
   for(const id of answerScopes)for(const note of ordered(rows,id))if(note.id!==pinId)expected.get(note.id).pitch+=3;
   // Four Ground notes map to Glass indices0,1,3,4. Index0 is pinned; the other three rise by3.
   for(const id of shadowScopes)for(const note of ordered(rows,id).slice(1))expected.get(note.id).pitch+=3;
  },{clips:6,notes:26,fields:26},answerLineage);
 const shadow=makeCase('exchange-aligned-soft-shadow',
  "Within each existing Ground shadow occurrence in Exchange, align its rhythm with the Glass source phrase with zero lag, while keeping the occurrence placements. Set each shadow note to half its source note's MIDI velocity, rounded to the nearest integer. Keep the current octave displacement, pitches and note lengths. Leave the Glass answers, Ember sources, pins, unrelated occurrences and other sections unchanged.",
  'shadow-exchange',{params:{delayTicks:0,velocityScale:0.5}},expected=>{
   for(const id of shadowScopes)ordered(rows,id).forEach((note,i)=>{expected.get(note.id).startTick-=120;expected.get(note.id).velocity=[30,34,36,33][i];});
  },{clips:3,notes:12,fields:24},answerLineage);
 const firstInterruptSource=ordered(rows,'rupture-glass-1').find(n=>!n.muted);ensure(firstInterruptSource,'missing interruption source');
 const interruptLineage=interruptScopes.flatMap(id=>['a1','a4'].map(local=>({noteId:id+'::'+local,relationId:'interrupt-rupture',sourceNoteId:firstInterruptSource.id})));
 const interrupt=makeCase('rupture-first-note-gap',
  'In Rupture, move the interruption cue to the first audible Glass source note and make the gap half a beat. Apply this to the current three Ember target occurrences. Restore notes that were muted only by the old gap and mute notes starting in the new gap. Preserve pins, pitches, note lengths, velocities, occurrence placements, unselected occurrences and every other section.',
  'interrupt-rupture',{params:{sourceNoteIndex:0,gapTicks:240}},expected=>{
   for(const id of interruptScopes){const first=expected.get(id+'::a1'),oldGap=expected.get(id+'::a4');ensure(first&&oldGap&&first.muted===false&&oldGap.muted===true,'original interruption state differs in '+id);first.muted=true;oldGap.muted=false;}
  },{clips:3,notes:6,fields:6},interruptLineage);
 return {version:1,baselineRows:clone(rows),pinIds:[pinId],baselineDefinition:'Flat performed-note clips grouped by occurrence; relation propagation disabled. Apply each listed note change explicitly. Structural counts are not measured human actions or editing time.',cases:[answer,shadow,interrupt]};
}
export function applyClipBaseline(baselineRows,clipPlan,pinIds){
 const state=new Map(baselineRows.map(n=>[n.id,clone(n)])),pins=new Set(pinIds),seen=new Set();
 for(const clip of clipPlan)for(const change of clip.changes){
  ensure(!pins.has(change.noteId)&&!seen.has(change.noteId),'baseline attempted a pinned or duplicate edit');
  const current=state.get(change.noteId);ensure(current&&current.occurrenceId===clip.occurrenceId&&equal(current,change.before),'baseline clip identity or before-state mismatch');
  ensure(change.after.id===current.id&&change.after.occurrenceId===current.occurrenceId&&change.after.threadId===current.threadId,'baseline attempted identity change');
  state.set(change.noteId,clone(change.after));seen.add(change.noteId);
 }
 return [...state.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export function modelInputFor(task,frozenProject){return {brief:task.prompt,project:clone(frozenProject)};}
