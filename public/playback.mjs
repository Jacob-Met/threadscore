export function audioJob(job,score,options={}){
 const worker=new Worker('/audio-worker.mjs',{type:'module'}),id=crypto.randomUUID();
 let settled=false,rejectJob;
 const promise=new Promise((resolve,reject)=>{
  rejectJob=reject;
  worker.onmessage=event=>{if(event.data.id!==id||settled)return;settled=true;worker.terminate();if(event.data.ok)resolve(event.data.result);else reject(Error(event.data.error||'Audio render failed.'));};
  worker.onerror=event=>{if(settled)return;settled=true;worker.terminate();reject(Error(event.message||'Audio worker failed.'));};
  worker.postMessage({id,job,score,options});
 });
 return {promise,cancel(){if(settled)return;settled=true;worker.terminate();rejectJob(new DOMException('Rendering cancelled.','AbortError'));}};
}
export class ScorePlayer{
 constructor(onState){this.onState=onState;this.sequence=0;this.context=null;this.source=null;this.job=null;this.timer=null;}
 stop(){this.sequence++;this.job?.cancel();this.job=null;if(this.source){this.source.onended=null;try{this.source.stop();}catch{}this.source.disconnect();this.source=null;}clearInterval(this.timer);this.timer=null;this.onState({state:'stopped',seconds:0});}
 async play(score,options={}){
  this.stop();const sequence=this.sequence;
  this.context??=new AudioContext();await this.context.resume();if(sequence!==this.sequence)return;
  this.onState({state:'rendering',seconds:0});this.job=audioJob('render',score,options);
  try{
   const audio=await this.job.promise;if(sequence!==this.sequence)return;this.job=null;
   const buffer=this.context.createBuffer(audio.channels.length,audio.frameCount,audio.sampleRate);audio.channels.forEach((channel,i)=>buffer.copyToChannel(channel,i));
   const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.context.destination);this.source=source;
   const started=this.context.currentTime;source.onended=()=>{if(sequence===this.sequence)this.stop();};source.start();
   this.onState({state:'playing',seconds:0,peak:audio.peak,frames:audio.frameCount});
   this.timer=setInterval(()=>{if(sequence===this.sequence)this.onState({state:'playing',seconds:Math.min(buffer.duration,this.context.currentTime-started),peak:audio.peak,frames:audio.frameCount});},100);
  }catch(error){if(sequence===this.sequence){this.job=null;this.onState({state:'error',error:error.message});}if(error.name!=='AbortError'&&sequence===this.sequence)throw error;}
 }
}
