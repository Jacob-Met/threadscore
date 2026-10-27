import {renderPcm,encodeWav,preflightAudio} from '/src/synth.mjs';
import {createZip} from '/src/zip.mjs';
self.onmessage=event=>{
 const {id,job,score,options={}}=event.data;
 try{
  if(job==='render'){const audio=renderPcm(score,options);self.postMessage({id,ok:true,result:audio},audio.channels.map(c=>c.buffer));}
  else if(job==='wav'){const audio=renderPcm(score,options),bytes=encodeWav(audio);self.postMessage({id,ok:true,result:{bytes,frameCount:audio.frameCount,sampleRate:audio.sampleRate,peak:audio.peak}},[bytes.buffer]);}
  else if(job==='stems'){
   const encoder=new TextEncoder(),metadataBudget=64*1024;
   const names=score.threads.map((thread,index)=>String(index+1).padStart(2,'0')+'-'+String(thread.name||thread.id).replace(/[^a-z0-9]+/gi,'-').slice(0,50)+'.wav');
   if(names.some(name=>encoder.encode(name).length>512)||encoder.encode(JSON.stringify(score.threads.map(t=>t.id))).length>32*1024)throw Error('Stem identifiers exceed the metadata budget.');
   preflightAudio(score,{...options,stemCount:score.threads.length,metadataBytes:metadataBudget,zipEntryCount:score.threads.length+1});
   const entries=[],receipts=[];
   for(let index=0;index<score.threads.length;index++){const thread=score.threads[index],audio=renderPcm(score,{...options,threadIds:[thread.id]}),name=names[index];entries.push({name,data:encodeWav(audio)});receipts.push({threadId:thread.id,name,frameCount:audio.frameCount,sampleRate:audio.sampleRate,peak:audio.peak});}
   const metadata=encoder.encode(JSON.stringify({format:'threadscore-stems',version:1,bpm:score.bpm,ppq:score.ppq,durationTicks:score.durationTicks,masterGain:options.masterGain??.65,receipts},null,2));
   if(metadata.length>metadataBudget)throw Error('Stem metadata exceeds its reserved budget.');
   entries.push({name:'stems.json',data:metadata});
   const bytes=createZip(entries);self.postMessage({id,ok:true,result:{bytes,receipts}},[bytes.buffer]);
  }else throw Error('Unknown audio operation.');
 }catch(error){self.postMessage({id,ok:false,error:error.message});}
};
