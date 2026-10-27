const clone=x=>structuredClone(x);
const integer=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const fields=['startTick','durationTicks','pitch','velocity','muted'];
const values=n=>Object.fromEntries(fields.map(k=>[k,n[k]]));
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,sorted(x[k])])):x;
const canonical=x=>JSON.stringify(sorted(x));
const same=(a,b)=>canonical(values(a))===canonical(values(b));
function reject(code,message,details={}){throw Object.assign(Error(message),{code,details});}
function requireThat(condition,code,message,details){if(!condition)reject(code,message,details);}
const failure=e=>({ok:false,errors:[{code:e.code||'INVALID_PROJECT',message:e.message,...(e.details||{})}]});
const param=(key,min,max,step,defaultValue)=>({key,min,max,step,default:defaultValue,integer:step===1});
export const RELATION_DEFINITIONS={
 answer:{label:'Answer',description:'Source contour answers in the target rhythm; the closing note returns to the source opening.',parameters:[param('interval',-12,12,1,3),param('delayTicks',0,480,1,0),param('velocityScale',.2,1.5,.05,.9)]},
 shadow:{label:'Shadow',description:'Source pitch, local rhythm and duration become a quieter delayed target voice.',parameters:[param('interval',-24,24,1,-12),param('delayTicks',0,480,1,120),param('velocityScale',.2,1,.05,.6)]},
 invert:{label:'Invert',description:'Reflect the source contour around an explicit pitch axis, retaining target rhythm.',parameters:[param('axis',24,96,1,60)]},
 interrupt:{label:'Interrupt',description:'A selected source onset cuts target notes and opens a measured rest.',parameters:[param('sourceNoteIndex',0,31,1,2),param('gapTicks',1,1920,1,480)]},
 reconcile:{label:'Reconcile',description:'Target pitches approach source pitch classes; its ending approaches the source ending.',parameters:[param('strength',0,1,.05,.75)]},
 gradualDiverge:{label:'Gradual divergence',description:'Source contour gradually separates into the target contour with accumulating pitch and rhythm drift.',parameters:[param('semitones',-12,12,1,7),param('driftTicks',0,480,1,120)]}
};
function parameters(relation){
 const def=RELATION_DEFINITIONS[relation.kind];requireThat(def,'INVALID_PROJECT','Unknown relationship kind '+relation.kind+'.');
 const input=relation.params??{};requireThat(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_PROJECT','Relationship params must be an object.');
 const allowed=new Set(def.parameters.map(p=>p.key));for(const key of Object.keys(input))requireThat(allowed.has(key),'INVALID_PROJECT','Unknown '+relation.kind+' parameter '+key+'.');
 return Object.fromEntries(def.parameters.map(p=>{const value=input[p.key]??p.default;requireThat(Number.isFinite(value)&&value>=p.min&&value<=p.max&&(!p.integer||Number.isInteger(value)),'INVALID_PROJECT','Invalid parameter '+relation.id+'.'+p.key+'.');return[p.key,value];}));
}
function index(items,label,max){requireThat(Array.isArray(items)&&items.length<=max,'INVALID_PROJECT',label+' must be an array with at most '+max+' entries.');const map=new Map();for(const item of items){requireThat(item&&typeof item.id==='string'&&item.id.length>0&&item.id.length<=128&&!item.id.includes('::')&&!map.has(item.id),'INVALID_PROJECT',label+' IDs must be unique nonempty strings without ::.');map.set(item.id,item);}return map;}
const MAX_ANCESTRY_WORK_ENTRIES=1000000,MAX_ANCESTRY_CANONICAL_BYTES=64*1024*1024;
function ancestry(entries,workBudget=null){const seen=new Set(),result=[];let inspected=0;for(const entry of entries){if(workBudget)requireThat(++workBudget.entries<=MAX_ANCESTRY_WORK_ENTRIES,'COMPLEXITY_LIMIT','Ancestry work budget exceeded (entry inspections).');requireThat(++inspected<=8192,'COMPLEXITY_LIMIT','Ancestry input exceeds the bounded inspection budget.');const key=canonical(entry);if(workBudget){workBudget.canonicalBytes+=key.length*2;requireThat(workBudget.canonicalBytes<=MAX_ANCESTRY_CANONICAL_BYTES,'COMPLEXITY_LIMIT','Ancestry work budget exceeded (canonical data).');}if(seen.has(key))continue;seen.add(key);result.push(entry);requireThat(result.length<=2048,'COMPLEXITY_LIMIT','A note exceeds the ancestry limit.');}return result;}
function checkNote(n,occ,end){requireThat(integer(n.startTick,occ.startTick)&&integer(n.durationTicks,1)&&n.startTick+n.durationTicks<=end&&integer(n.pitch,0,127)&&integer(n.velocity,1,127)&&typeof n.muted==='boolean','NOTE_BOUNDS','Note '+n.id+' exceeds its occurrence, MIDI pitch, velocity or tick bounds.',{noteId:n.id});}
function nearestPitch(pitch,classes){let best=0,distance=Infinity;for(let p=0;p<=127;p++)if(classes.has(p%12)){const d=Math.abs(p-pitch);if(d<distance){best=p;distance=d;}}return best;}
function transform(notes,source,sourceOccurrence,targetOccurrence,relation,p,workBudget){
 const audible=source.filter(n=>!n.muted).sort((a,b)=>a.startTick-b.startTick||a.pitch-b.pitch||a.id.localeCompare(b.id));
 requireThat(audible.length,'INVALID_PROJECT','Relationship '+relation.id+' has no audible source notes.');
 if(relation.kind==='shadow')requireThat(notes.length<=audible.length,'INVALID_PROJECT','Shadow '+relation.id+' needs at least as many source notes as target notes.');
 if(relation.kind==='interrupt')requireThat(p.sourceNoteIndex<audible.length,'INVALID_PROJECT','Interrupt '+relation.id+' source note index is outside its audible source.');
 const classes=new Set(audible.map(n=>n.pitch%12)),meanVelocity=audible.reduce((a,n)=>a+n.velocity,0)/audible.length;
 return notes.map((original,i)=>{
  const n={...original},mapped=audible[Math.floor(i*audible.length/notes.length)],last=i===notes.length-1;let used=[mapped];
  switch(relation.kind){
   case 'answer':{const s=last?audible[0]:mapped;used=[s];n.pitch=s.pitch+p.interval;n.startTick+=p.delayTicks;n.velocity=Math.round(n.velocity*p.velocityScale);break;}
   case 'shadow':n.pitch=mapped.pitch+p.interval;n.startTick=targetOccurrence.startTick+(mapped.startTick-sourceOccurrence.startTick)+p.delayTicks;n.durationTicks=mapped.durationTicks;n.velocity=Math.round(mapped.velocity*p.velocityScale);n.muted=false;break;
   case 'invert':n.pitch=2*p.axis-mapped.pitch;break;
   case 'interrupt':{const s=audible[p.sourceNoteIndex];used=[s];const cut=targetOccurrence.startTick+(s.startTick-sourceOccurrence.startTick),end=cut+p.gapTicks;if(n.startTick<cut&&n.startTick+n.durationTicks>cut)n.durationTicks=cut-n.startTick;else if(n.startTick>=cut&&n.startTick<end)n.muted=true;break;}
   case 'reconcile':{used=audible;const target=nearestPitch(n.pitch,last?new Set([audible.at(-1).pitch%12]):classes);n.pitch=Math.round(n.pitch+(target-n.pitch)*p.strength);n.velocity=Math.round(n.velocity+(meanVelocity-n.velocity)*p.strength);break;}
   case 'gradualDiverge':{const t=notes.length===1?1:i/(notes.length-1);n.pitch=Math.round(mapped.pitch*(1-t)+n.pitch*t+p.semitones*t);n.startTick+=Math.round(p.driftTicks*t);break;}
  }
  function* entries(){yield* original.ancestry;for(const s of used)yield* s.ancestry;yield {kind:'relation',relationId:relation.id,relationKind:relation.kind,parameters:clone(p),sourceOccurrenceId:sourceOccurrence.id,sourceNoteIds:used.map(s=>s.id),targetOccurrenceId:targetOccurrence.id};}n.ancestry=ancestry(entries(),workBudget);return n;
 });
}
export function compileScore(project){
 try{
  const ancestryWorkBudget={entries:0,canonicalBytes:0};
  requireThat(project&&project.schemaVersion===1&&typeof project.id==='string'&&integer(project.revision)&&project.ppq===480&&Number.isFinite(project.bpm)&&project.bpm>=30&&project.bpm<=240&&integer(project.durationTicks,1,480*4*3600),'INVALID_PROJECT','Score needs schemaVersion 1, revision, PPQ 480, BPM 30–240 and a bounded positive duration.');
  const sections=index(project.sections,'Sections',128),motifs=index(project.motifs,'Motifs',64),threads=index(project.threads,'Threads',16),occurrences=index(project.occurrences,'Occurrences',1024),relations=index(project.relations??[],'Relations',128);
  requireThat(sections.size&&motifs.size&&threads.size&&occurrences.size,'INVALID_PROJECT','A score needs sections, motifs, threads and occurrences.');
  let priorEnd=0;for(const s of [...sections.values()].sort((a,b)=>a.startTick-b.startTick)){requireThat(integer(s.startTick)&&integer(s.endTick,1)&&s.endTick>s.startTick&&s.endTick<=project.durationTicks&&s.startTick>=priorEnd,'INVALID_PROJECT','Section '+s.id+' is invalid or overlaps another section.');priorEnd=s.endTick;}
  for(const m of motifs.values()){
   requireThat(integer(m.lengthTicks,1),'INVALID_PROJECT','Motif '+m.id+' needs a positive length.');const noteMap=index(m.notes,'Motif '+m.id+' notes',256);requireThat(noteMap.size,'INVALID_PROJECT','Motif '+m.id+' is empty.');
   for(const n of m.notes)requireThat(integer(n.startTick)&&integer(n.durationTicks,1)&&n.startTick+n.durationTicks<=m.lengthTicks&&integer(n.pitch,0,127)&&integer(n.velocity,1,127),'NOTE_BOUNDS','Motif note '+m.id+'/'+n.id+' is invalid.');
  }
  for(const t of threads.values())requireThat(motifs.has(t.motifId)&&integer(t.channel,0,15)&&integer(t.program,0,127),'UNKNOWN_REFERENCE','Thread '+t.id+' has an unknown motif or invalid MIDI channel/program.');
  requireThat(new Set(project.threads.map(t=>t.channel)).size===threads.size,'INVALID_PROJECT','Each thread requires a distinct MIDI channel.');
  let noteBudget=0;for(const o of occurrences.values()){const thread=threads.get(o.threadId);requireThat(thread,'UNKNOWN_REFERENCE','Unknown occurrence thread.');noteBudget+=motifs.get(thread.motifId).notes.length;requireThat(noteBudget<=20000,'COMPLEXITY_LIMIT','The score exceeds 20000 compiled notes.');}
  const baseByOccurrence=new Map(),allBase=new Map(),edges=new Map(),indegree=new Map();
  for(const o of occurrences.values()){
   const t=threads.get(o.threadId),s=sections.get(o.sectionId);requireThat(t&&s,'UNKNOWN_REFERENCE','Occurrence '+o.id+' has an unknown thread or section.');const m=motifs.get(t.motifId),transpose=o.transpose??0;
   requireThat(integer(o.startTick,s.startTick)&&integer(transpose,-48,48)&&o.startTick+m.lengthTicks<=s.endTick,'NOTE_BOUNDS','Occurrence '+o.id+' does not fit its section.');
   const notes=m.notes.map(n=>({id:o.id+'::'+n.id,sourceNoteId:n.id,occurrenceId:o.id,threadId:t.id,sectionId:s.id,channel:t.channel,program:t.program,startTick:o.startTick+n.startTick,durationTicks:n.durationTicks,pitch:n.pitch+transpose,velocity:n.velocity,muted:false,ancestry:[{kind:'motif',motifId:m.id,sourceNoteId:n.id},{kind:'occurrence',occurrenceId:o.id,threadId:t.id}]})).sort((a,b)=>a.startTick-b.startTick||a.pitch-b.pitch||a.id.localeCompare(b.id));
   baseByOccurrence.set(o.id,notes);for(const n of notes)allBase.set(n.id,n);edges.set(o.id,new Set());indegree.set(o.id,0);
  }
  const parameterMap=new Map();
  for(const r of relations.values()){
   const source=occurrences.get(r.sourceOccurrenceId);requireThat(source&&threads.has(r.sourceThreadId)&&threads.has(r.targetThreadId),'UNKNOWN_REFERENCE','Relationship '+r.id+' has unknown source/thread references.');
   requireThat(source.threadId===r.sourceThreadId&&Array.isArray(r.scopeOccurrenceIds)&&r.scopeOccurrenceIds.length>0&&new Set(r.scopeOccurrenceIds).size===r.scopeOccurrenceIds.length,'SCOPE_VIOLATION','Relationship '+r.id+' has invalid source or target scope.');
   for(const id of r.scopeOccurrenceIds){const target=occurrences.get(id);requireThat(target,'UNKNOWN_REFERENCE','Unknown target occurrence '+id+'.');requireThat(target.threadId===r.targetThreadId&&target.sectionId===source.sectionId,'SCOPE_VIOLATION','Relationship '+r.id+' crosses its section or target thread.');if(!edges.get(source.id).has(id)){edges.get(source.id).add(id);indegree.set(id,indegree.get(id)+1);}}
   parameterMap.set(r.id,parameters(r));
  }
  const locks=project.locks??{},overrides=project.noteOverrides??{};
  requireThat(locks&&typeof locks==='object'&&!Array.isArray(locks)&&overrides&&typeof overrides==='object'&&!Array.isArray(overrides),'INVALID_PROJECT','Locks and note overrides must be objects.');
  for(const id of [...Object.keys(locks),...Object.keys(overrides)])requireThat(allBase.has(id),'UNKNOWN_REFERENCE','Lock/override addresses unknown note '+id+'.');
  const queue=[...occurrences.keys()].filter(id=>indegree.get(id)===0),order=[];
  for(let qi=0;qi<queue.length;qi++){const id=queue[qi];order.push(id);for(const next of edges.get(id)){indegree.set(next,indegree.get(next)-1);if(indegree.get(next)===0)queue.push(next);}}
  requireThat(order.length===occurrences.size,'CYCLE','Relationship dependencies contain a cycle.');
  const compiledByOccurrence=new Map();let ancestryTotal=0;
  for(const id of order){
   const o=occurrences.get(id),thread=threads.get(o.threadId),end=o.startTick+motifs.get(thread.motifId).lengthTicks;let notes=clone(baseByOccurrence.get(id));
   for(const r of relations.values())if(r.scopeOccurrenceIds.includes(id))notes=transform(notes,compiledByOccurrence.get(r.sourceOccurrenceId),occurrences.get(r.sourceOccurrenceId),o,r,parameterMap.get(r.id),ancestryWorkBudget);
   notes=notes.map(n=>{
    const override=overrides[n.id],lock=locks[n.id];
    if(override){requireThat(override.note&&Array.isArray(override.ancestry),'INVALID_PROJECT','Invalid override '+n.id+'.');n={...n,...values(override.note),ancestry:clone(override.ancestry)};}
    if(lock)n={...n,...values(lock),ancestry:ancestry([...(Array.isArray(lock.ancestry)?clone(lock.ancestry):clone(allBase.get(n.id).ancestry)),{kind:'lock',noteId:n.id}],ancestryWorkBudget)};
    checkNote(n,o,end);requireThat(Array.isArray(n.ancestry)&&n.ancestry.length<=2048,'COMPLEXITY_LIMIT','Note ancestry exceeds its supported bound.');ancestryTotal+=n.ancestry.length;requireThat(ancestryTotal<=200000,'COMPLEXITY_LIMIT','The score exceeds the total ancestry budget.');return n;
   });compiledByOccurrence.set(id,notes);
  }
  const notes=[...compiledByOccurrence.values()].flat().sort((a,b)=>a.startTick-b.startTick||a.channel-b.channel||a.pitch-b.pitch||a.id.localeCompare(b.id));
  const active=new Map();for(const n of notes)if(!n.muted){const key=n.channel+':'+n.pitch,prior=active.get(key);requireThat(!prior||prior.startTick+prior.durationTicks<=n.startTick,'NOTE_OVERLAP','Notes '+prior?.id+' and '+n.id+' overlap on the same MIDI channel/pitch.',{noteIds:[prior?.id,n.id].filter(Boolean)});active.set(key,n);}
  return {ok:true,score:{id:project.id,title:project.title,revision:project.revision,ppq:480,bpm:project.bpm,durationTicks:project.durationTicks,notes,threads:clone(project.threads),sections:clone(project.sections),occurrences:clone(project.occurrences),relations:clone(project.relations??[]),dependencyOrder:order},errors:[]};
 }catch(e){return failure(e);}
}
function needScore(project){const result=compileScore(project);if(!result.ok){const e=result.errors[0];reject(e.code,e.message,e);}return result.score;}
function difference(before,after){const old=new Map(before.notes.map(n=>[n.id,n]));return after.notes.filter(n=>!same(old.get(n.id),n)).map(n=>({noteId:n.id,before:clone(old.get(n.id)),after:clone(n)}));}
function shortHash(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');}
export function proposeProgram(project,program){
 try{
  const before=needScore(project);
  requireThat(program&&program.version===1&&program.expectedRevision===project.revision&&Array.isArray(program.ops)&&program.ops.length>0&&program.ops.length<=16,'INVALID_PROGRAM','Program needs version 1, the exact expectedRevision and one to sixteen setRelation operations.');
  const candidate=clone(project),seen=new Set(),allowed=new Set(['kind','params','sourceThreadId','targetThreadId','sourceOccurrenceId','scopeOccurrenceIds']);
  for(const op of program.ops){
   requireThat(op&&op.op==='setRelation'&&typeof op.relationId==='string'&&!seen.has(op.relationId)&&op.patch&&typeof op.patch==='object'&&!Array.isArray(op.patch),'INVALID_PROGRAM','Each setRelation operation needs one distinct relation ID and an object patch.');seen.add(op.relationId);
   for(const key of Object.keys(op.patch))requireThat(allowed.has(key),'INVALID_PROGRAM','Program cannot edit relation field '+key+'.');
   const at=candidate.relations.findIndex(r=>r.id===op.relationId);requireThat(at>=0,'UNKNOWN_REFERENCE','Unknown relationship '+op.relationId+'.');
   const previous=candidate.relations[at],patch=clone(op.patch);
   if(patch.params!==undefined)requireThat(patch.params&&typeof patch.params==='object'&&!Array.isArray(patch.params),'INVALID_PROGRAM','Relationship params patch must be an object.');
   const changedKind=patch.kind!==undefined&&patch.kind!==previous.kind;
   candidate.relations[at]={...previous,...patch,id:previous.id,params:changedKind?{...(patch.params??{})}:{...(previous.params??{}),...(patch.params??{})}};
  }
  candidate.revision=project.revision+1;const score=needScore(candidate),diff=difference(before,score),baseSnapshot=canonical(project);
  return {ok:true,id:'proposal-'+shortHash(baseSnapshot+canonical(program)),baseRevision:project.revision,baseSnapshot,program:clone(program),project:candidate,score,diff,affectedOccurrenceIds:[...new Set(diff.map(d=>d.after.occurrenceId))],errors:[]};
 }catch(e){return failure(e);}
}
export function proposeRelationshipEdit(project,relationId,patch){return proposeProgram(project,{version:1,expectedRevision:project.revision,ops:[{op:'setRelation',relationId,patch}]});}
function verifiedProposal(project,proposal){
 requireThat(proposal?.ok&&proposal.baseRevision===project.revision&&proposal.baseSnapshot===canonical(project),'STALE_PROPOSAL','The score changed after this proposal was prepared. Preview again before accepting.');
 const fresh=proposeProgram(project,proposal.program);if(!fresh.ok){const e=fresh.errors[0];reject(e.code,e.message,e);}
 requireThat(canonical(fresh.project)===canonical(proposal.project),'INVALID_PROPOSAL','Proposal contents do not match the typed program and original score.');return fresh;
}
export function acceptProposal(project,proposal){try{const fresh=verifiedProposal(project,proposal);return {ok:true,project:clone(fresh.project),score:fresh.score,errors:[]};}catch(e){return failure(e);}}
export function acceptNoteChanges(project,proposal,noteIds){
 try{
  const fresh=verifiedProposal(project,proposal),before=needScore(project),changes=new Map(fresh.diff.map(d=>[d.noteId,d]));
  requireThat(Array.isArray(noteIds)&&noteIds.length>0&&new Set(noteIds).size===noteIds.length,'INVALID_PROGRAM','Select one or more distinct changed note IDs.');
  const selected=new Set(noteIds),candidate=clone(project);candidate.noteOverrides??={};
  for(const id of noteIds){const change=changes.get(id);requireThat(change,'UNKNOWN_REFERENCE','Note '+id+' is not changed by this proposal.');requireThat(!candidate.locks?.[id],'LOCKED_NOTE','Note '+id+' is locked.');candidate.noteOverrides[id]={note:values(change.after),ancestry:ancestry([...clone(change.after.ancestry),{kind:'accepted-edit',proposalId:fresh.id,noteId:id}])};}
  candidate.revision=project.revision+1;const score=needScore(candidate),actual=difference(before,score),extra=actual.filter(d=>!selected.has(d.noteId));
  requireThat(!extra.length,'PARTIAL_DEPENDENCY','Selected source edits also affect unselected dependent notes. Select the causal group or accept the complete relationship.',{requiredNoteIds:extra.map(d=>d.noteId)});
  const compiled=new Map(score.notes.map(n=>[n.id,n]));for(const id of noteIds)requireThat(same(compiled.get(id),changes.get(id).after),'PARTIAL_DEPENDENCY','Accepted note '+id+' would not match its preview.');
  return {ok:true,project:candidate,score,errors:[]};
 }catch(e){return failure(e);}
}
export function setNoteLocks(project,noteIds,locked=true){
 try{
  const score=needScore(project),notes=new Map(score.notes.map(n=>[n.id,n]));requireThat(Array.isArray(noteIds)&&noteIds.length>0&&typeof locked==='boolean','INVALID_PROGRAM','Lock edits need note IDs and a boolean.');
  const candidate=clone(project);candidate.locks??={};for(const id of noteIds){const n=notes.get(id);requireThat(n,'UNKNOWN_REFERENCE','Unknown note '+id+'.');if(locked)candidate.locks[id]={...values(n),ancestry:clone(n.ancestry)};else delete candidate.locks[id];}
  candidate.revision=project.revision+1;return {ok:true,project:candidate,score:needScore(candidate),errors:[]};
 }catch(e){return failure(e);}
}
export function setNoteOverride(project,noteId,patch){
 try{
  const score=needScore(project),note=score.notes.find(n=>n.id===noteId);requireThat(note,'UNKNOWN_REFERENCE','Unknown note '+noteId+'.');requireThat(!project.locks?.[noteId],'LOCKED_NOTE','Unlock '+noteId+' before editing it.');
  requireThat(patch&&typeof patch==='object'&&!Array.isArray(patch)&&Object.keys(patch).length>0&&Object.keys(patch).every(k=>fields.includes(k)),'INVALID_PROGRAM','Manual note edits may change startTick, durationTicks, pitch, velocity or muted only.');
  const candidate=clone(project);candidate.noteOverrides??={};candidate.revision=project.revision+1;candidate.noteOverrides[noteId]={note:{...values(note),...clone(patch)},ancestry:ancestry([...clone(note.ancestry),{kind:'manual-edit',noteId,revision:candidate.revision}])};
  return {ok:true,project:candidate,score:needScore(candidate),errors:[]};
 }catch(e){return failure(e);}
}
export function clearNoteOverrides(project,noteIds){
 try{
  const score=needScore(project),known=new Set(score.notes.map(n=>n.id));requireThat(Array.isArray(noteIds)&&noteIds.length>0,'INVALID_PROGRAM','Choose note pins to release.');const candidate=clone(project);candidate.noteOverrides??={};
  for(const id of noteIds){requireThat(known.has(id),'UNKNOWN_REFERENCE','Unknown note '+id+'.');delete candidate.noteOverrides[id];}
  candidate.revision=project.revision+1;return {ok:true,project:candidate,score:needScore(candidate),errors:[]};
 }catch(e){return failure(e);}
}
