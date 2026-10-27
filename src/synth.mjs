export function preflightAudio(score,{sampleRate=48000,startTick=0,endTick=score?.durationTicks,stemCount=0,metadataBytes=0,zipEntryCount=stemCount?stemCount+1:0}={}){
 const PCM_LIMIT=128*1024*1024,ZIP_LIMIT=128*1024*1024;
 if(!score||!Number.isFinite(score.bpm)||score.bpm<=0||!Number.isSafeInteger(score.ppq)||score.ppq<=0||!Number.isSafeInteger(score.durationTicks)||score.durationTicks<1)throw RangeError('Invalid score audio clock.');
 if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>96000)throw RangeError('Sample rate must be an integer from 8000 to 96000.');
 if(!Number.isSafeInteger(startTick)||!Number.isSafeInteger(endTick)||startTick<0||endTick<=startTick||endTick>score.durationTicks)throw RangeError('Invalid audio interval.');
 for(const [name,value]of Object.entries({stemCount,metadataBytes,zipEntryCount}))if(!Number.isSafeInteger(value)||value<0)throw RangeError('Invalid '+name+'.');
 if(stemCount&&zipEntryCount<stemCount)throw RangeError('ZIP entry count excludes planned stems.');
 const secondsPerTick=Math.round(60000000/score.bpm)/1000000/score.ppq,requestedDurationSeconds=(endTick-startTick)*secondsPerTick;
 if(!Number.isFinite(secondsPerTick)||secondsPerTick<=0||!Number.isFinite(requestedDurationSeconds)||requestedDurationSeconds>600)throw RangeError('Audio duration exceeds the 600-second render limit.');
 const frameCount=Math.round(requestedDurationSeconds*sampleRate),pcmBytes=frameCount*2*Float32Array.BYTES_PER_ELEMENT;
 if(!Number.isSafeInteger(frameCount)||!Number.isSafeInteger(pcmBytes)||pcmBytes>PCM_LIMIT)throw RangeError('Audio working-memory budget exceeded; shorten the interval or lower the sample rate.');
 const wavBytes=44+frameCount*4,plannedZipBytes=stemCount?stemCount*wavBytes+metadataBytes+22+zipEntryCount*2048:0;
 if(!Number.isSafeInteger(plannedZipBytes)||plannedZipBytes>ZIP_LIMIT)throw RangeError('Stem archive budget exceeded; shorten the interval or lower the sample rate.');
 return {secondsPerTick,requestedDurationSeconds,durationSeconds:frameCount/sampleRate,frameCount,pcmBytes,wavBytes,plannedZipBytes};
}
// Deterministic, original additive voices. MIDI programs are timbre hints, not sampled GM instruments.
const TAU=2*Math.PI;
export function renderPcm(score,{sampleRate=48000,startTick=0,endTick=score.durationTicks,threadIds=null,masterGain=.65}={}){
 if(!score||!Number.isInteger(score.ppq)||score.ppq<1||!Number.isFinite(score.bpm)||score.bpm<=0||!Array.isArray(score.notes))throw Error('Provide a compiled symbolic score.');
 if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>96000)throw Error('Render sample rate must be an integer from 8000 to 96000 Hz.');
 if(!Number.isSafeInteger(startTick)||!Number.isSafeInteger(endTick)||startTick<0||endTick<=startTick||endTick>score.durationTicks)throw Error('Render interval must lie inside the score.');
 if(!Number.isFinite(masterGain)||masterGain<0||masterGain>1)throw Error('Master gain must be from zero to one.');
 const {secondsPerTick,frameCount}=preflightAudio(score,{sampleRate,startTick,endTick});
 const channels=[new Float32Array(frameCount),new Float32Array(frameCount)];
 const threads=score.threads||[],selected=threadIds?new Set(threadIds):null;
 let renderedNotes=0;
 for(const note of score.notes){
  if(note.muted||(selected&&!selected.has(note.threadId)))continue;
  const end=note.startTick+note.durationTicks;
  if(end<=startTick||note.startTick>=endTick)continue;
  if(!Number.isSafeInteger(note.startTick)||!Number.isSafeInteger(note.durationTicks)||note.startTick<0||note.durationTicks<1||end>score.durationTicks||!Number.isInteger(note.pitch)||note.pitch<0||note.pitch>127||!Number.isInteger(note.velocity)||note.velocity<1||note.velocity>127)throw Error('A compiled note is outside the audio renderer bounds.');
  const noteStart=(note.startTick-startTick)*secondsPerTick,noteDuration=note.durationTicks*secondsPerTick;
  const first=Math.max(0,Math.round(noteStart*sampleRate)),last=Math.min(frameCount,Math.round((end-startTick)*secondsPerTick*sampleRate));
  const frequency=440*Math.pow(2,(note.pitch-69)/12),index=Math.max(0,threads.findIndex(t=>t.id===note.threadId));
  if(frequency>=sampleRate*.48)throw Error('This pitch requires a higher rendering sample rate.');
  const pan=threads.length<2?0:(index/(threads.length-1)*1.1-.55);
  const left=Math.sqrt((1-pan)/2),right=Math.sqrt((1+pan)/2),amplitude=masterGain*.17*Math.pow(note.velocity/127,1.4);
  const voice=(note.program??index)%3,attack=Math.min(.012,noteDuration*.15),release=Math.min(.11,noteDuration*.25);
  for(let frame=first;frame<last;frame++){
   const t=frame/sampleRate-noteStart;if(t<0||t>noteDuration)continue;
   const attackGain=Math.min(1,t/Math.max(1e-6,attack)),releaseGain=Math.min(1,(noteDuration-t)/Math.max(1e-6,release));
   const envelope=attackGain*releaseGain*(voice===1?Math.exp(-t*1.5):.72+.28*Math.exp(-t*4));
   const fundamental=Math.sin(TAU*frequency*t),second=frequency*2<sampleRate*.48?Math.sin(TAU*frequency*2*t):0,third=frequency*3<sampleRate*.48?Math.sin(TAU*frequency*3*t):0;
   const wave=voice===0?.8*fundamental+.14*second+.06*third:voice===1?.86*fundamental+.14*second:.86*fundamental+.14*third;
   const sample=amplitude*envelope*wave;channels[0][frame]+=sample*left;channels[1][frame]+=sample*right;
  }
  renderedNotes++;
 }
 let peak=0,clippedSamples=0;for(const channel of channels)for(const value of channel){if(!Number.isFinite(value))throw Error('Audio render produced a non-finite sample.');peak=Math.max(peak,Math.abs(value));if(Math.abs(value)>1)clippedSamples++;}
 return {channels,sampleRate,frameCount,durationSeconds:frameCount/sampleRate,startTick,endTick,masterGain,peak,clippedSamples,renderedNotes,voiceDescription:'Original additive synthesis; MIDI programs are approximate timbre hints.'};
}
export function encodeWav(audio){
 const {channels,sampleRate}=audio;if(!Array.isArray(channels)||channels.length<1||channels.length>8||!channels.every(c=>c instanceof Float32Array&&c.length===channels[0].length)||!Number.isInteger(sampleRate)||sampleRate<1)throw Error('Invalid PCM source.');
 const frames=channels[0].length,length=44+frames*channels.length*2;if(length>0xffffffff)throw Error('WAV exceeds RIFF size.');
 const bytes=new Uint8Array(length),view=new DataView(bytes.buffer),text=(p,s)=>{for(let i=0;i<s.length;i++)bytes[p+i]=s.charCodeAt(i);};
 text(0,'RIFF');view.setUint32(4,length-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels.length,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*channels.length*2,true);view.setUint16(32,channels.length*2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,length-44,true);
 let position=44;for(let frame=0;frame<frames;frame++)for(const channel of channels){const sample=channel[frame];if(!Number.isFinite(sample)||Math.abs(sample)>1)throw Error('PCM samples must be finite and within -1 to 1; lower the master gain before export.');view.setInt16(position,Math.round(sample<0?sample*32768:sample*32767),true);position+=2;}
 return bytes;
}
