import {compileScore} from './score.mjs';
export function importMidiMotif(project,parsed,{threadId,trackId,fromBeat,toBeat,fileName='import.mid',sha256}={}){
 const thread=project.threads.find(t=>t.id===threadId),track=parsed.tracks.find(t=>t.id===trackId);
 if(!thread||!track)throw Error('Choose a source track and a thread.');
 const motif=project.motifs.find(m=>m.id===thread.motifId),from=fromBeat*parsed.ppq,to=toBeat*parsed.ppq;
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<=from)throw Error('Choose exact MIDI beat boundaries with the end after the start.');
 const scale=480/parsed.ppq,length=(to-from)*scale;
 if(!Number.isSafeInteger(length)||length>motif.lengthTicks)throw Error('The selected window must convert exactly and fit the existing '+motif.lengthTicks/480+'-beat motif.');
 const affectedThreads=new Set(project.threads.filter(t=>t.motifId===motif.id).map(t=>t.id)),affectedOccurrences=new Set(project.occurrences.filter(o=>affectedThreads.has(o.threadId)).map(o=>o.id));
 for(const id of [...Object.keys(project.locks||{}),...Object.keys(project.noteOverrides||{})])if(affectedOccurrences.has(id.split('::')[0]))throw Error('This motif has pinned or individually accepted notes. Release those edits before replacing its note identities.');
 const intersects=track.notes.filter(n=>n.startTick<to&&n.startTick+n.durationTicks>from);
 if(intersects.some(n=>n.startTick<from||n.startTick+n.durationTicks>to))throw Error('A note crosses the selected boundary. Include the entire note.');
 if(!intersects.length||intersects.length>256)throw Error('Choose a window containing 1 to 256 complete notes.');
 const notes=intersects.map((n,index)=>{
  const startTick=(n.startTick-from)*scale,durationTicks=n.durationTicks*scale;
  if(!Number.isSafeInteger(startTick)||!Number.isSafeInteger(durationTicks))throw Error('These MIDI ticks cannot convert exactly to PPQ 480. Choose a different window or quantize in your source editor.');
  return {id:'import-'+(index+1),startTick,durationTicks,pitch:n.pitch,velocity:n.velocity,importSourceNoteId:n.id};
 });
 const candidate=structuredClone(project),replacement=candidate.motifs.find(m=>m.id===motif.id);
 replacement.notes=notes;replacement.importProvenance={fileName:String(fileName).slice(0,255),sourceSha256:sha256||'not recorded',sourcePpq:parsed.ppq,sourceTrackId:track.id,windowStartTick:from,windowEndTick:to,noteOnly:true,sourceTempoEvents:parsed.tempoEvents.slice(0,128),disclosures:['Source tempo, meter, instruments, pedal, pitch bend and other expression are not reproduced.','Note timings are converted exactly; this score supplies its tempo and meter.']};
 candidate.revision=project.revision+1;const result=compileScore(candidate);if(!result.ok)throw Error(result.errors.map(e=>e.message).join(' '));return {ok:true,project:candidate,score:result.score,errors:[]};
}
