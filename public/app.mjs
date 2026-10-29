import {compileScore,RELATION_DEFINITIONS,proposeRelationshipEdit,proposeProgram,acceptProposal,acceptNoteChanges,setNoteLocks,setNoteOverride,clearNoteOverrides} from '/src/score.mjs';
import {createDemoProject} from '/src/demo.mjs';
import {parseMidi,encodeMidi} from '/src/midi.mjs';
import {encodeProject,decodeProject} from '/src/project.mjs';
import {importMidiMotif} from '/src/import.mjs';
import {ScorePlayer,audioJob} from '/playback.mjs';

const $=id=>document.getElementById(id),colors=['#e8b76c','#83cab7','#bca6df','#7fb6dc'],clone=x=>structuredClone(x);
const el=(tag,className='',text='')=>{const node=document.createElement(tag);if(className)node.className=className;if(text)node.textContent=text;return node;};
const svg=(tag,attrs={})=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))node.setAttribute(k,String(v));return node;};
const pitchName=p=>['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][p%12]+(Math.floor(p/12)-1);
const clock=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
const status=(message,type='')=>{$('status').textContent=message;$('status').className='status'+(type?' '+type:'');};
function checked(result){if(!result.ok)throw Error(result.errors.map(e=>e.message+(e.requiredNoteIds?.length?' Required dependent notes: '+e.requiredNoteIds.join(', '):'')).join(' '));return result;}
function guard(fn){return async event=>{try{await fn(event);}catch(error){status(error.message,'error');}};}
function button(text,className,fn){const node=el('button',className,text);node.type='button';node.addEventListener('click',guard(fn));return node;}
let project=createDemoProject(),score=checked(compileScore(project)).score,relationId='answer-exchange',sectionId='exchange',occurrenceId='exchange-glass-1',threadId='glass',noteId='exchange-glass-1::b1',mode='occurrence';
let proposal=null,selectedChanges=new Set(),history=[],modelEvidence=null,changeSerial=0,importSource=null,pendingImportThreadId=null,exportBusy=false,modelBusy=false,capabilities=null;
const player=new ScorePlayer(state=>{
 $('playback-time').textContent=state.state==='rendering'?'Rendering…':clock(state.seconds||0);
 $('score-play').dataset.playState=state.state;$('play-before').dataset.playState=state.state;$('play-after').dataset.playState=state.state;
 $('score-play').textContent=state.state==='rendering'?'Preparing audio…':state.state==='playing'?'▶ Playing':$('play-range').value==='whole'?'▶ Play piece':'▶ Play section';
 if(state.state==='error')status(state.error,'error');
});
function currentThread(){return project.threads.find(t=>t.id===threadId)||project.threads[0];}
function currentMotif(){return project.motifs.find(m=>m.id===currentThread().motifId);}
function currentOccurrence(){return project.occurrences.find(o=>o.id===occurrenceId)||null;}
function currentSection(){return project.sections.find(s=>s.id===sectionId)||project.sections[0];}
function currentRelation(){return project.relations.find(r=>r.id===relationId);}
function fixSelection(){
 if(!project.threads.some(t=>t.id===threadId))threadId=project.threads[0].id;
 if(!project.sections.some(s=>s.id===sectionId))sectionId=project.sections[0].id;
 const occurrence=currentOccurrence();
 if(!occurrence||occurrence.threadId!==threadId||occurrence.sectionId!==sectionId)occurrenceId=project.occurrences.find(o=>o.threadId===threadId&&o.sectionId===sectionId)?.id||null;
 if(!project.relations.some(r=>r.id===relationId))relationId=project.relations[0]?.id||'';
 const notes=mode==='motif'?currentMotif().notes:score.notes.filter(n=>n.occurrenceId===occurrenceId);
 if(!notes.some(n=>n.id===noteId))noteId=null;
}
function requireOccurrenceNote(){
 const occurrence=currentOccurrence();
 if(mode!=='occurrence'||!occurrence||occurrence.threadId!==threadId||occurrence.sectionId!==sectionId||!score.notes.some(n=>n.id===noteId&&n.occurrenceId===occurrence.id))throw Error('Choose a note in a placed occurrence before editing.');
 return occurrence;
}
function remember(){history.push({project:clone(project),modelEvidence:clone(modelEvidence)});if(history.length>30)history.shift();}
function adopt(result,message,{evidence=modelEvidence,resetSelection=false}={}){
 checked(result);remember();project=result.project;score=result.score;modelEvidence=evidence;
 if(resetSelection){const first=project.occurrences[0];occurrenceId=first.id;threadId=first.threadId;sectionId=first.sectionId;mode='occurrence';noteId=null;}
 changeSerial++;player.stop();proposal=null;selectedChanges.clear();fixSelection();render();status(message);
}
function commit(candidate,message){candidate.revision=project.revision+1;adopt({...checked(compileScore(candidate)),project:candidate},message);}
function clearPreview(){if(proposal)player.stop();draftSerial++;proposal=null;selectedChanges.clear();renderProposal();renderTimeline();}
function selectOccurrence(id){const o=project.occurrences.find(o=>o.id===id);if(!o)return;occurrenceId=o.id;threadId=o.threadId;sectionId=o.sectionId;mode='occurrence';noteId=null;renderTimeline();renderEditor();}
function selectRelation(id){
 relationId=id;const r=currentRelation();if(r){sectionId=project.occurrences.find(o=>o.id===r.sourceOccurrenceId).sectionId;occurrenceId=r.scopeOccurrenceIds[0];threadId=r.targetThreadId;mode='occurrence';noteId=null;}
 clearPreview();renderRelations();renderRelationEditor();renderTimeline();renderEditor();
}
function miniature(notes,length,color){
 const root=svg('svg',{viewBox:'0 0 240 60','aria-hidden':'true'}),min=Math.min(...notes.map(n=>n.pitch))-2,max=Math.max(...notes.map(n=>n.pitch))+2,range=Math.max(12,max-min);
 for(const n of notes)root.append(svg('rect',{x:n.startTick/length*240,y:48-(n.pitch-min)/range*42,width:Math.max(2,n.durationTicks/length*240-1),height:4,rx:1,fill:color,opacity:n.muted?.22:.9}));
 return root;
}
function renderThreads(){
 const host=$('threads');host.replaceChildren();
 project.threads.forEach((t,i)=>{
  const m=project.motifs.find(m=>m.id===t.motifId),card=el('article','thread-card');card.dataset.threadId=t.id;card.style.setProperty('--thread-color',colors[i%colors.length]);
  const heading=el('div','thread-title');heading.append(el('span','thread-number',String(i+1).padStart(2,'0')),el('h2','',t.name||t.id));card.append(heading);
  card.append(el('p','thread-description',m.notes.length+' notes · '+m.lengthTicks/480+' beats · '+(m.importProvenance?'imported motif':'original motif')));
  const mini=el('div','motif-mini');mini.append(miniature(m.notes,m.lengthTicks,colors[i%colors.length]));card.append(mini);
  const actions=el('div','thread-actions');
  actions.append(button('▶ Hear motif','quiet play-motif',()=>playMotif(t.id)),button('Edit motif','quiet edit-motif',()=>{threadId=t.id;mode='motif';noteId=null;renderTimeline();renderEditor();$('editor-title').scrollIntoView({behavior:'smooth',block:'center'});}),button('Import MIDI','quiet import-motif',()=>{pendingImportThreadId=t.id;$('midi-file').value='';$('midi-file').click();}));
  card.append(actions);host.append(card);
 });
}
function renderRelations(){
 const host=$('relations-list');host.replaceChildren();
 for(const r of project.relations){
  const source=project.threads.find(t=>t.id===r.sourceThreadId),target=project.threads.find(t=>t.id===r.targetThreadId),b=button('','relation-item'+(r.id===relationId?' active':''),()=>selectRelation(r.id));b.dataset.relationId=r.id;b.setAttribute('aria-pressed',String(r.id===relationId));
  b.append(el('strong','',RELATION_DEFINITIONS[r.kind].label),el('span','',source.name+' → '+target.name));host.append(b);
 }
 if(!project.relations.length)host.append(el('p','help','This score has no relationships.'));
}
function renderTimeline(){
 fixSelection();
 const sections=$('sections');sections.replaceChildren();
 for(const s of project.sections){const b=button(s.name||s.id,s.id===sectionId?'active':'',()=>{sectionId=s.id;const occurrence=project.occurrences.find(o=>o.sectionId===s.id&&o.threadId===threadId)||project.occurrences.find(o=>o.sectionId===s.id);occurrenceId=occurrence?.id||null;if(occurrence)threadId=occurrence.threadId;noteId=null;mode='occurrence';renderTimeline();renderEditor();});b.dataset.sectionId=s.id;b.setAttribute('aria-pressed',String(s.id===sectionId));sections.append(b);}
 const host=$('arrangement');host.replaceChildren();const affected=new Set(proposal?.affectedOccurrenceIds||[]);
 project.threads.forEach((t,i)=>{
  const row=el('div','track-row'),name=el('div','track-name',t.name),lane=el('div','track-lane');row.style.setProperty('--thread-color',colors[i%colors.length]);row.append(name,lane);
  for(const o of project.occurrences.filter(o=>o.threadId===t.id)){
   const m=project.motifs.find(m=>m.id===t.motifId),b=button('','occurrence'+(o.id===occurrenceId?' active':'')+(affected.has(o.id)?' preview':''),()=>selectOccurrence(o.id));b.dataset.occurrenceId=o.id;b.style.left=o.startTick/project.durationTicks*100+'%';b.style.width=m.lengthTicks/project.durationTicks*100+'%';b.title=(t.name||t.id)+' · '+(project.sections.find(s=>s.id===o.sectionId).name||o.sectionId)+' · beat '+(o.startTick/480+1);b.setAttribute('aria-label',b.title);
   b.append(miniature(score.notes.filter(n=>n.occurrenceId===o.id).map(n=>({...n,startTick:n.startTick-o.startTick})),m.lengthTicks,colors[i%colors.length]));lane.append(b);
  }host.append(row);
 });
 $('revision-label').textContent='Revision '+project.revision;
}
const parameterLabels={interval:'Pitch interval · semitones',delayTicks:'Delay · ticks',velocityScale:'Dynamic scale',axis:'Reflection axis · MIDI pitch',sourceNoteIndex:'Interrupting source note · from zero',gapTicks:'Rest length · ticks',strength:'Reconciliation amount',semitones:'Final divergence · semitones',driftTicks:'Final drift · ticks'};
function renderParameters(kind,params={}){
 const host=$('relation-params');host.replaceChildren();const def=RELATION_DEFINITIONS[kind];if(!def)return;
 $('relation-description').textContent=def.description;
 for(const p of def.parameters){const label=el('label','',parameterLabels[p.key]||p.key),input=el('input');input.id='param-'+p.key;input.type='number';input.min=p.min;input.max=p.max;input.step=p.step;input.value=params[p.key]??p.default;label.append(input);host.append(label);}
}
function renderRelationEditor(){
 const r=currentRelation();$('preview-relationship').disabled=!r;$('relation-kind').replaceChildren();$('relation-source').replaceChildren();$('relation-scope').replaceChildren();
 if(!r){$('relation-title').textContent='No connection selected';$('relation-description').textContent='';$('relation-params').replaceChildren();return;}
 $('relation-title').textContent=RELATION_DEFINITIONS[r.kind].label+' the thread.';
 for(const [kind,def]of Object.entries(RELATION_DEFINITIONS)){const o=el('option','',def.label);o.value=kind;$('relation-kind').append(o);}$('relation-kind').value=r.kind;
 const source=project.occurrences.find(o=>o.id===r.sourceOccurrenceId);
 for(const occurrence of project.occurrences.filter(o=>o.sectionId===source.sectionId)){const t=project.threads.find(t=>t.id===occurrence.threadId),o=el('option','',t.name+' · beat '+(occurrence.startTick/480+1));o.value=occurrence.id;$('relation-source').append(o);}$('relation-source').value=r.sourceOccurrenceId;
 renderParameters(r.kind,r.params);
 for(const o of project.occurrences.filter(o=>o.threadId===r.targetThreadId&&o.sectionId===source.sectionId)){
  const label=el('label','scope-row'),input=el('input');input.type='checkbox';input.checked=r.scopeOccurrenceIds.includes(o.id);input.dataset.occurrenceId=o.id;label.append(input,document.createTextNode('Beat '+(o.startTick/480+1)));$('relation-scope').append(label);
 }
}
function renderProposal(){
 const panel=$('proposal-panel');panel.hidden=!proposal;if(!proposal)return;
 $('proposal-summary').textContent=proposal.diff.length+' notes change in '+proposal.affectedOccurrenceIds.length+' passages. The current score stays in place until you accept.';
 const host=$('changes');host.replaceChildren();
 for(const d of proposal.diff.slice(0,300)){
  const label=el('label','change-row'),input=el('input');input.type='checkbox';input.dataset.noteId=d.noteId;input.checked=selectedChanges.has(d.noteId);
  input.addEventListener('change',()=>{if(input.checked)selectedChanges.add(d.noteId);else selectedChanges.delete(d.noteId);$('accept-selected').disabled=!selectedChanges.size;$('accept-selected').textContent='Accept '+selectedChanges.size+' selected note edit'+(selectedChanges.size===1?'':'s');});
  const text=el('span'),title=el('strong','',d.after.occurrenceId+' / '+d.after.sourceNoteId),description=el('small','',pitchName(d.before.pitch)+' → '+pitchName(d.after.pitch)+' · velocity '+d.before.velocity+' → '+d.after.velocity+(d.before.startTick!==d.after.startTick?' · timing moved':'')+(d.before.muted!==d.after.muted?' · '+(d.after.muted?'rest':'audible'):''));
  text.append(title,description);label.append(input,text);host.append(label);
 }
 if(proposal.diff.length>300)host.append(el('p','help','The first 300 changed notes are shown. Full acceptance applies the complete program.'));
 $('accept-selected').disabled=!selectedChanges.size;$('accept-selected').textContent='Accept selected note edits';
}
function render(){
 fixSelection();$('project-title').value=project.title||'Untitled score';$('tempo').value=project.bpm;$('score-duration').textContent=clock(score.durationTicks/score.ppq*60/score.bpm);$('score-count').textContent=project.motifs.length+' motifs';$('undo').disabled=!history.length;
 renderThreads();renderRelations();renderTimeline();renderRelationEditor();renderEditor();renderProposal();
}
// APP_PART_ONE

function renderEditor(){
 fixSelection();
 const thread=currentThread(),motif=currentMotif(),occurrence=currentOccurrence(),isSource=mode==='motif';
 $('mode-label').textContent=isSource?'PERSISTENT SOURCE MOTIF':'OCCURRENCE EDITOR';$('editor-title').textContent=thread.name+' · '+(isSource?'the original motif':currentSection().name||currentSection().id);
 $('source-mode').textContent=isSource?'Return to occurrence':'Edit source motif';$('occurrence-select').replaceChildren();const placements=project.occurrences.filter(o=>o.threadId===thread.id);$('occurrence-select').disabled=isSource||!placements.length;
 if(!occurrence){const option=el('option','','No occurrence in this section');option.value='';option.disabled=true;$('occurrence-select').append(option);}
 for(const o of placements){const section=project.sections.find(s=>s.id===o.sectionId),option=el('option','',(section.name||section.id)+' · beat '+(o.startTick/480+1));option.value=o.id;$('occurrence-select').append(option);}$('occurrence-select').value=occurrence?.id||'';
 const notes=isSource?motif.notes:occurrence?score.notes.filter(n=>n.occurrenceId===occurrence.id):[],origin=isSource?0:occurrence?.startTick||0,roll=$('piano-roll');roll.replaceChildren();
 const rangeNotes=notes.length?notes:motif.notes,low=Math.max(0,Math.min(...rangeNotes.map(n=>n.pitch))-3),high=Math.min(127,Math.max(low+12,Math.max(...rangeNotes.map(n=>n.pitch))+3)),rows=high-low+1,rowHeight=240/rows,plotX=58,plotWidth=930;
 for(let pitch=low;pitch<=high;pitch++){const y=24+(high-pitch)*rowHeight;roll.append(svg('rect',{x:plotX,y,width:plotWidth,height:rowHeight,fill:[1,3,6,8,10].includes(pitch%12)?'#151d29':'#222e3d'}));if(pitch%12===0||pitch===low||pitch===high){const label=svg('text',{x:6,y:y+rowHeight*.7,class:'piano-label'});label.textContent=pitchName(pitch);roll.append(label);}}
 const beats=motif.lengthTicks/480,gridStep=Math.max(1,Math.ceil(beats/32));
 for(let beat=0;beat<=beats;beat+=gridStep){const x=plotX+beat/beats*plotWidth;roll.append(svg('line',{x1:x,x2:x,y1:24,y2:264,stroke:beat%4===0?'#566476':'#344252','stroke-width':beat%4===0?1.2:.5}));const label=svg('text',{x:x+3,y:14,class:'piano-bar-label'});label.textContent=String(beat+1);roll.append(label);}
 for(const n of notes){
  const locked=!isSource&&Boolean(project.locks?.[n.id]),color=colors[Math.max(0,project.threads.findIndex(t=>t.id===thread.id))%colors.length],rect=svg('rect',{x:plotX+(n.startTick-origin)/motif.lengthTicks*plotWidth,y:24+(high-n.pitch)*rowHeight+1,width:Math.max(3,n.durationTicks/motif.lengthTicks*plotWidth-2),height:Math.max(3,rowHeight-2),rx:3,fill:color,opacity:n.muted?.28:.95,class:'piano-note'+(n.id===noteId?' selected':'')+(locked?' locked':''),'data-note-id':n.id,tabindex:0,role:'button','aria-label':pitchName(n.pitch)+', beat '+((n.startTick-origin)/480+1)+(locked?', pinned':'')+(n.muted?', rest':'')});
  const title=svg('title');title.textContent=n.id+(locked?' · pinned':'');rect.append(title);
  const choose=()=>{noteId=n.id;renderEditor();};rect.addEventListener('click',choose);rect.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose();}});roll.append(rect);
 }
 const chosen=notes.find(n=>n.id===noteId);$('note-fields').disabled=!chosen;$('add-note').hidden=!isSource;$('delete-note').hidden=!isSource;$('pin-note').hidden=isSource||!occurrence;$('clear-note').hidden=isSource||!occurrence;$('apply-note').disabled=!chosen||(!isSource&&Boolean(project.locks?.[chosen.id]));$('delete-note').disabled=!chosen;$('clear-note').disabled=!chosen||!project.noteOverrides?.[chosen.id];
 $('editor-help').textContent=!isSource&&!occurrence?'No passage is placed for this thread in this section. Select a passage or edit the source motif.':isSource?'Source edits propagate through every occurrence and its relationships. Pinned notes keep their performed values.':'Choose a note. Editing this occurrence creates an explicit note edit; pinning preserves its performed values through future relationship changes.';
 if(!chosen){for(const id of ['note-pitch','note-start','note-duration','note-velocity'])$(id).value='';$('selected-note-label').textContent=!isSource&&!occurrence?'No occurrence in this section':'Select a note';$('note-ancestry').textContent=!isSource&&!occurrence?'This thread has no occurrence in the selected section. Its source motif is still available.':'Select a note to inspect its actual source and transformations.';return;}
 $('selected-note-label').textContent=pitchName(chosen.pitch)+' · '+chosen.id+(project.locks?.[chosen.id]?' · pinned':'');$('note-pitch').value=chosen.pitch;$('note-start').value=(chosen.startTick-origin)/480;$('note-duration').value=chosen.durationTicks/480;$('note-velocity').value=chosen.velocity;
 $('pin-note').textContent=project.locks?.[chosen.id]?'Unpin note':'Pin note';$('clear-note').disabled=!project.noteOverrides?.[chosen.id];$('apply-note').disabled=!isSource&&Boolean(project.locks?.[chosen.id]);
 $('note-ancestry').textContent=JSON.stringify(isSource?[{kind:'motif',motifId:motif.id,sourceNoteId:chosen.id},...(motif.importProvenance?[{kind:'midi-import',source:motif.importProvenance,sourceNoteId:chosen.importSourceNoteId}]:[])]:chosen.ancestry,null,2);
}
function rangeOptions(whole=false){const section=currentSection();return {startTick:whole?0:section.startTick,endTick:whole?score.durationTicks:section.endTick,masterGain:Number($('master-gain').value)};}
async function playMotif(id){
 const t=project.threads.find(t=>t.id===id),m=project.motifs.find(m=>m.id===t.motifId);
 const source={...score,durationTicks:m.lengthTicks,threads:[t],notes:m.notes.map(n=>({...n,threadId:t.id,channel:t.channel,program:t.program,muted:false}))};
 await player.play(source,{masterGain:Number($('master-gain').value)});
}
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type})),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function saveProject(){
 const serial=changeSerial,document=await encodeProject(project,{modelEvidence});if(serial!==changeSerial)throw Error('The score changed while saving. Save the current score again.');
 download('threadscore-score.json',JSON.stringify(document,null,2),'application/json');status('Editable score saved with its motifs, relationships, pins and note ancestry.');
}
function exportMidi(){
 const bytes=encodeMidi({ppq:score.ppq,bpm:score.bpm,durationTicks:score.durationTicks,tracks:score.threads.map(t=>({name:t.name,channel:t.channel,program:t.program,notes:score.notes.filter(n=>n.threadId===t.id&&!n.muted)}))});
 download('threadscore.mid',bytes,'audio/midi');status('MIDI score exported: '+score.notes.filter(n=>!n.muted).length+' notes, '+clock(score.durationTicks/480*60/score.bpm)+'.');
}
async function exportAudio(job){
 if(exportBusy)throw Error('An audio export is already rendering.');exportBusy=true;player.stop();$('export-wav').disabled=true;$('export-stems').disabled=true;const snapshot=clone(score);
 status(job==='stems'?'Rendering aligned thread stems…':'Rendering the stereo score…','busy');
 try{const result=await audioJob(job,snapshot,{masterGain:Number($('master-gain').value)}).promise;download(job==='stems'?'threadscore-stems.zip':'threadscore.wav',result.bytes,job==='stems'?'application/zip':'audio/wav');status(job==='stems'?'Thread stems exported from the same project origin, with the same duration and master level.':'Stereo WAV exported at 48 kHz.');}
 finally{exportBusy=false;$('export-wav').disabled=false;$('export-stems').disabled=false;}
}
async function openProject(file){
 if(!file)return;if(file.size>2*1024*1024)throw Error('A score file must be no larger than 2 MiB.');const serial=changeSerial,loaded=await decodeProject(JSON.parse(await file.text()));if(serial!==changeSerial)throw Error('The score changed while opening this file. Open it again when ready.');
 adopt({ok:true,project:loaded.project,score:loaded.score},'Opened and recompiled the editable score. Imported model receipts remain unverified.',{evidence:loaded.modelEvidence,resetSelection:true});
}
async function openMidi(file,targetThreadId){
 if(!file)return;if(file.size>4*1024*1024)throw Error('MIDI imports must be no larger than 4 MiB.');
 const baseSerial=changeSerial,bytes=new Uint8Array(await file.arrayBuffer()),parsed=parseMidi(bytes),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(baseSerial!==changeSerial)throw Error('The score changed while opening MIDI. Select the file again.');
 const targetThread=project.threads.find(t=>t.id===targetThreadId),targetMotif=targetThread&&project.motifs.find(m=>m.id===targetThread.motifId);
 if(!targetMotif)throw Error('The target motif is no longer available. Choose a thread and select the MIDI file again.');
 const tracks=parsed.tracks.filter(t=>t.notes.length);if(!tracks.length)throw Error('This MIDI file contains no playable note track.');
 importSource={parsed,fileName:file.name,sha256:hash,baseSerial};$('import-track').replaceChildren();$('import-thread').replaceChildren();
 for(const t of tracks){const option=el('option','',(t.name||t.id)+' · '+t.notes.length+' notes');option.value=t.id;$('import-track').append(option);}
 for(const t of project.threads){const option=el('option','',t.name);option.value=t.id;$('import-thread').append(option);}$('import-thread').value=targetThread.id;
 $('import-start').value=0;$('import-end').value=Math.min(targetMotif.lengthTicks/480,Math.max(1,parsed.durationTicks/parsed.ppq));$('import-error').textContent='';
 $('import-summary').textContent=file.name+' · PPQ '+parsed.ppq+' · '+tracks.length+' note tracks.'+(parsed.warnings.length?' '+parsed.warnings.slice(0,3).join(' '):'');
 $('import-dialog').showModal();
}
function confirmImport(){
 try{
  if(!importSource||importSource.baseSerial!==changeSerial)throw Error('The score changed. Close this dialog and select the MIDI file again.');
  const target=$('import-thread').value,result=importMidiMotif(project,importSource.parsed,{threadId:target,trackId:$('import-track').value,fromBeat:Number($('import-start').value),toBeat:Number($('import-end').value),fileName:importSource.fileName,sha256:importSource.sha256});
  threadId=target;mode='motif';noteId=null;adopt(result,'Imported the selected notes into the persistent motif. Relationships were recompiled at this score’s tempo.');$('import-dialog').close();importSource=null;
 }catch(error){$('import-error').textContent=error.message;}
}
// APP_PART_TWO

let draftSerial=0;
function showProposal(result,message){
 proposal=checked(result);selectedChanges.clear();draftSerial++;player.stop();renderTimeline();renderProposal();status(message||proposal.diff.length+' changed notes are ready to audition. Accept the relationship or choose individual note edits.');
}
function invalidateDraft(){clearPreview();status('Relationship controls changed. Preview to hear and inspect the result.');}
$('relation-kind').addEventListener('change',()=>{renderParameters($('relation-kind').value,{});invalidateDraft();});
$('relation-params').addEventListener('input',invalidateDraft);$('relation-source').addEventListener('change',invalidateDraft);$('relation-scope').addEventListener('change',invalidateDraft);
$('preview-relationship').addEventListener('click',guard(()=>{
 clearPreview();const r=currentRelation();if(!r)throw Error('Choose a relationship.');const kind=$('relation-kind').value,params={};
 for(const p of RELATION_DEFINITIONS[kind].parameters){const input=$('param-'+p.key);if(!input.value||!input.checkValidity())throw Error('Enter a valid '+(parameterLabels[p.key]||p.key)+'.');params[p.key]=Number(input.value);}
 const source=project.occurrences.find(o=>o.id===$('relation-source').value),scope=[...$('relation-scope').querySelectorAll('input:checked')].map(input=>input.dataset.occurrenceId);
 showProposal(proposeRelationshipEdit(project,r.id,{kind,params,sourceOccurrenceId:source.id,sourceThreadId:source.threadId,scopeOccurrenceIds:scope}));
}));
$('accept-relationship').addEventListener('click',guard(()=>{if(!proposal)throw Error('Prepare a preview first.');adopt(acceptProposal(project,proposal),'Relationship accepted. Its addressed passages and downstream dependencies now use the new program.',{evidence:proposal.modelEvidence??modelEvidence});}));
$('accept-selected').addEventListener('click',guard(()=>{if(!proposal)throw Error('Prepare a preview first.');const count=selectedChanges.size;adopt(acceptNoteChanges(project,proposal,[...selectedChanges]),count+' individual note edit'+(count===1?'':'s')+' accepted. The relationship program is unchanged.',{evidence:proposal.modelEvidence??modelEvidence});}));
$('discard-proposal').addEventListener('click',()=>{player.stop();clearPreview();renderRelationEditor();status('Preview discarded. The score is unchanged.');});
$('play-before').addEventListener('click',guard(()=>player.play(score,rangeOptions($('play-range').value==='whole'))));
$('play-after').addEventListener('click',guard(()=>{if(!proposal)throw Error('Prepare a preview first.');return player.play(proposal.score,rangeOptions($('play-range').value==='whole'));}));
$('score-play').addEventListener('click',guard(()=>player.play(score,rangeOptions($('play-range').value==='whole'))));
$('score-stop').addEventListener('click',()=>player.stop());
$('play-range').addEventListener('change',()=>{player.stop();});
$('master-gain').addEventListener('change',()=>{player.stop();status('Master level changed. Play again or export at the new level.');});
$('occurrence-select').addEventListener('change',()=>selectOccurrence($('occurrence-select').value));
$('source-mode').addEventListener('click',()=>{
 if(mode==='motif'){mode='occurrence';occurrenceId=project.occurrences.find(o=>o.threadId===threadId&&o.sectionId===sectionId)?.id||null;}
 else mode='motif';noteId=null;renderEditor();renderTimeline();
});
$('apply-note').addEventListener('click',guard(()=>{
 const occurrence=mode==='occurrence'?requireOccurrenceNote():null;
 for(const id of ['note-pitch','note-start','note-duration','note-velocity'])if(!$(id).value||!$(id).checkValidity())throw Error('Enter valid note values before applying.');
 const localStart=Number($('note-start').value)*480,duration=Number($('note-duration').value)*480;if(!Number.isSafeInteger(localStart)||!Number.isSafeInteger(duration))throw Error('Note timing must use exact score ticks.');
 const patch={pitch:Number($('note-pitch').value),startTick:localStart,durationTicks:duration,velocity:Number($('note-velocity').value)};
 if(mode==='motif'){const candidate=clone(project),motif=candidate.motifs.find(m=>m.id===currentMotif().id),note=motif.notes.find(n=>n.id===noteId);if(!note)throw Error('Select a source note.');Object.assign(note,patch);commit(candidate,'Source motif edited. Occurrences and relationships were recompiled; pinned performed notes remain fixed.');}
 else{patch.startTick+=occurrence.startTick;adopt(setNoteOverride(project,noteId,patch),'Occurrence note edited. Its source motif stays available for the other passages.');}
}));
$('pin-note').addEventListener('click',guard(()=>{requireOccurrenceNote();const locked=Boolean(project.locks?.[noteId]);adopt(setNoteLocks(project,[noteId],!locked),locked?'Note unpinned. It follows the relationship again.':'Note pinned at its current performed values.');}));
$('clear-note').addEventListener('click',guard(()=>{requireOccurrenceNote();adopt(clearNoteOverrides(project,[noteId]),'Individual note edit released. The underlying relationship was recompiled.');}));
$('add-note').addEventListener('click',guard(()=>{
 if(mode!=='motif')throw Error('Choose a source motif before adding a note.');
 const candidate=clone(project),motif=candidate.motifs.find(m=>m.id===currentMotif().id),used=new Set(motif.notes.map(n=>n.pitch));let pitch=60;while(used.has(pitch)&&pitch<127)pitch++;if(used.has(pitch))throw Error('Choose a free pitch by editing the motif first.');
 let startTick=0,durationTicks=0;for(const n of [...motif.notes].sort((a,b)=>a.startTick-b.startTick)){if(n.startTick>startTick){durationTicks=Math.min(240,n.startTick-startTick);break;}startTick=Math.max(startTick,n.startTick+n.durationTicks);}
 if(!durationTicks&&startTick<motif.lengthTicks)durationTicks=Math.min(240,motif.lengthTicks-startTick);
 if(!durationTicks)throw Error('This motif has no empty rhythmic gap. Shorten a note before adding one.');
 const addedId='note-'+crypto.randomUUID();motif.notes.push({id:addedId,startTick,durationTicks,pitch,velocity:80});commit(candidate,'Source note added in an empty rhythmic gap. Adjust its pitch, timing or velocity below.');noteId=addedId;renderEditor();
}));
$('delete-note').addEventListener('click',guard(()=>{
 if(mode!=='motif'||!noteId)throw Error('Select a source note.');const candidate=clone(project),motif=candidate.motifs.find(m=>m.id===currentMotif().id);motif.notes=motif.notes.filter(n=>n.id!==noteId);commit(candidate,'Source note deleted and affected passages recompiled.');noteId=null;renderEditor();
}));
$('project-title').addEventListener('change',guard(()=>{const title=$('project-title').value.trim();if(!title)throw Error('Give this composition a title.');const candidate=clone(project);candidate.title=title;commit(candidate,'Composition renamed.');}));
$('tempo').addEventListener('change',guard(()=>{if(!$('tempo').value||!$('tempo').checkValidity())throw Error('Enter a tempo from 30 to 240 BPM.');const candidate=clone(project);candidate.bpm=Number($('tempo').value);commit(candidate,'Tempo updated. MIDI and audio exports will use this tempo.');}));
$('undo').addEventListener('click',guard(()=>{
 const prior=history.pop();if(!prior)return;prior.project.revision=project.revision+1;const result=checked(compileScore(prior.project));project=prior.project;score=result.score;modelEvidence=prior.modelEvidence;changeSerial++;player.stop();proposal=null;selectedChanges.clear();render();status('Previous score restored as a new revision.');
}));
$('demo-reset').addEventListener('click',guard(()=>{const candidate=createDemoProject();candidate.revision=project.revision+1;threadId='glass';sectionId='exchange';occurrenceId='exchange-glass-1';relationId='answer-exchange';mode='occurrence';noteId='exchange-glass-1::b1';adopt({...checked(compileScore(candidate)),project:candidate},'Original three-minute composition restored. Undo can recover your previous score.',{evidence:null});}));
$('project-save').addEventListener('click',guard(saveProject));$('project-open').addEventListener('click',()=>{$('project-file').value='';$('project-file').click();});
$('project-file').addEventListener('change',guard(event=>openProject(event.target.files[0])));
$('midi-file').addEventListener('change',guard(event=>{const targetThreadId=pendingImportThreadId??threadId;pendingImportThreadId=null;return openMidi(event.target.files[0],targetThreadId);}));
$('midi-file').addEventListener('cancel',()=>{pendingImportThreadId=null;});
$('import-confirm').addEventListener('click',confirmImport);$('import-cancel').addEventListener('click',()=>{$('import-dialog').close();importSource=null;});
$('import-dialog').addEventListener('cancel',()=>{importSource=null;});
$('export-midi').addEventListener('click',guard(exportMidi));$('export-wav').addEventListener('click',guard(()=>exportAudio('wav')));$('export-stems').addEventListener('click',guard(()=>exportAudio('stems')));
async function loadCapabilities(){
 try{const response=await fetch('/api/capabilities',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Unavailable');capabilities=await response.json();$('model-draft').disabled=!capabilities.available;$('model-status').textContent=capabilities.available?'Ready to propose programs with '+capabilities.model+'. Calls occur only when you choose Draft.':capabilities.reason||'The optional model route is unavailable. Manual composing, playback and export are ready.';}
 catch{$('model-draft').disabled=true;$('model-status').textContent='The optional model route is unavailable. Manual composing, playback and export are ready.';}
}
$('model-draft').addEventListener('click',guard(async()=>{
 if(modelBusy||!capabilities?.available)throw Error('The optional model route is unavailable.');
 const instruction=$('intent').value.trim();if(!instruction||instruction.length>2000)throw Error('Write a musical intention of 1 to 2000 characters.');
 modelBusy=true;$('model-draft').disabled=true;const baseSerial=changeSerial,baseDraft=draftSerial,snapshot=JSON.stringify(project);
 try{
  const document=await encodeProject(project,{modelEvidence});
  status('Requesting an inspectable relationship program…','busy');
  const response=await fetch('/api/program',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({document,instruction}),signal:AbortSignal.timeout(90000)}),text=await response.text();
  if(text.length>262144)throw Error('The model route returned an oversized response.');let data;try{data=JSON.parse(text);}catch{throw Error('The model route did not return a valid program response.');}
  if(!response.ok)throw Error(data.error?.message||data.error||'The model request failed. It was not retried automatically.');
  if(baseSerial!==changeSerial||baseDraft!==draftSerial||snapshot!==JSON.stringify(project))throw Error('The score or preview changed while the model was working. Its response was discarded.');
  const result=checked(proposeProgram(project,data.program));
  const evidence=data.evidence?{...data.evidence,...(Array.isArray(data.attempts)?{attempts:data.attempts}:{}),evidenceOrigin:'live_receipt_this_session'}:null;
  const custody=await encodeProject(result.project,{modelEvidence:evidence});
  if(baseSerial!==changeSerial||baseDraft!==draftSerial||snapshot!==JSON.stringify(project))throw Error('The score changed while validating the response. Its proposal was discarded.');
  result.modelEvidence=custody.modelEvidence;showProposal(result,'A model program compiled successfully. Listen and inspect its '+result.diff.length+' note changes before accepting.');$('model-status').textContent='Last received program: '+(custody.modelEvidence?.receivedModel||capabilities.model)+'. Musical quality has not been independently assessed.';
 }catch(error){if(error.name==='TimeoutError'||error.name==='AbortError'||error instanceof TypeError)throw Error('The request outcome is unknown. No automatic retry was sent. '+error.message);throw error;}
 finally{modelBusy=false;$('model-draft').disabled=!capabilities?.available;}
}));
render();status('Three threads, six rooms. Select a relationship, preview a change, and listen to the passages it moves.');loadCapabilities();
// APP_COMPLETE
