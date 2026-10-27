const MAX_BYTES=4*1024*1024,MAX_EVENTS=100000,MAX_NOTES=20000,MAX_TICK=0x0fffffff;
const fail=message=>{throw Error('MIDI: '+message);};
const integer=(value,low,high,label)=>{if(!Number.isInteger(value)||value<low||value>high)fail(label+' must be an integer from '+low+' to '+high);return value;};
const textEncoder=new TextEncoder();
function append(target,values){for(const value of values)target.push(value);}
function nameBytes(name){if(typeof name!=='string')fail('track name must be text');const bytes=textEncoder.encode(name);if(bytes.length>1024)fail('track name exceeds 1024 UTF-8 bytes');return bytes;}
function timeline(events,kind){
 const output=[];
 for(const event of [...events].sort((a,b)=>a.tick-b.tick)){
  const previous=output.at(-1),signature=value=>kind==='tempo'?String(value.microsecondsPerQuarter):value.numerator+'/'+value.denominator+'/'+value.clocksPerClick+'/'+value.thirtySecondsPerQuarter;
  if(previous?.tick===event.tick){if(signature(previous)!==signature(event))fail('conflicting '+kind+' events at tick '+event.tick);continue;}output.push(event);
 }
 if(!output.length||output[0].tick!==0)output.unshift(kind==='tempo'?{tick:0,microsecondsPerQuarter:500000,bpm:120,implicit:true}:{tick:0,numerator:4,denominator:4,clocksPerClick:24,thirtySecondsPerQuarter:8,implicit:true});
 return output;
}
export function parseMidi(bytes,{maxBytes=MAX_BYTES}={}){
 integer(maxBytes,1,MAX_BYTES,'maxBytes');if(!(bytes instanceof Uint8Array))fail('input must be Uint8Array');if(bytes.length>maxBytes)fail('file exceeds the supported byte limit');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let position=0;
 function need(count,limit=bytes.length){if(!Number.isInteger(count)||count<0||position+count>limit)fail('truncated chunk or event');}
 function u8(limit){need(1,limit);return bytes[position++];}
 function u16(){need(2);const value=view.getUint16(position,false);position+=2;return value;}
 function u32(){need(4);const value=view.getUint32(position,false);position+=4;return value;}
 function tag(){need(4);const value=String.fromCharCode(...bytes.subarray(position,position+4));position+=4;return value;}
 function variable(limit){let value=0;for(let count=0;count<4;count++){const byte=u8(limit);value=value*128+(byte&127);if(!(byte&128))return value;}fail('variable-length integer exceeds four bytes');}
 function dataByte(limit){const value=u8(limit);if(value>=128)fail('status byte encountered inside channel data');return value;}
 if(tag()!=='MThd')fail('missing MThd header');if(u32()!==6)fail('unsupported MIDI header length');
 const format=u16(),physicalTrackCount=u16(),division=u16();
 if(format!==0&&format!==1)fail('only MIDI formats 0 and 1 are supported; format 2 is rejected');if(division&0x8000)fail('SMPTE time division is unsupported');
 const ppq=integer(division,1,32767,'PPQN');integer(physicalTrackCount,1,64,'physical track count');if(format===0&&physicalTrackCount!==1)fail('format 0 must contain exactly one track');
 const tracks=[],tempoRecords=[],meterRecords=[],uninterpretedEvents=[],warnings=[];let eventCount=0,noteCount=0,durationTicks=0,logicalTrackCount=0;
 for(let trackIndex=0;trackIndex<physicalTrackCount;trackIndex++){
  if(tag()!=='MTrk')fail('expected MTrk chunk');const chunkLength=u32();need(chunkLength);const limit=position+chunkLength;
  let tick=0,runningStatus=null,ended=false,sourceName='Track '+(trackIndex+1);const nameEvents=[],channelTracks=new Map(),openNotes=new Map();
  function channelTrack(channel){if(!channelTracks.has(channel)){if(++logicalTrackCount>128)fail('more than 128 logical channel tracks');channelTracks.set(channel,{id:'track-'+trackIndex+'-channel-'+channel,sourceTrackIndex:trackIndex,channel,program:0,programChanges:[],notes:[]});}return channelTracks.get(channel);}
  while(position<limit){
   if(++eventCount>MAX_EVENTS)fail('event count exceeds 100000');tick+=variable(limit);if(tick>MAX_TICK)fail('absolute timeline exceeds supported tick limit');
   let status=u8(limit);if(status<0x80){if(runningStatus===null)fail('running status used without a preceding channel status');position--;status=runningStatus;}
   if(status>=0x80&&status<=0xef){
    runningStatus=status;const kind=status&0xf0,channel=status&15,first=dataByte(limit),second=kind===0xc0||kind===0xd0?null:dataByte(limit),track=channelTrack(channel);
    if(kind===0x90&&second>0){
     const key=channel+':'+first;if(openNotes.has(key))fail('ambiguous overlapping same-pitch notes on one channel');if(++noteCount>MAX_NOTES)fail('note count exceeds 20000');openNotes.set(key,{id:'midi-'+trackIndex+'-'+channel+'-'+noteCount,pitch:first,velocity:second,channel,startTick:tick});
    }else if(kind===0x80||(kind===0x90&&second===0)){
     const key=channel+':'+first,note=openNotes.get(key);if(!note)fail('unmatched note-off');const durationTicks=tick-note.startTick;if(durationTicks<=0)fail('zero-duration notes are unsupported');track.notes.push({...note,durationTicks,releaseVelocity:kind===0x80?second:0});openNotes.delete(key);
    }else if(kind===0xc0){track.programChanges.push({tick,program:first});if(tick===0)track.program=first;}
    else uninterpretedEvents.push({sourceTrackIndex:trackIndex,tick,channel,status,data:Uint8Array.from(second===null?[first]:[first,second])});
   }else if(status===0xff){
    // SMF meta events retain the preceding channel running status (Mido-compatible).
    const metaType=u8(limit),length=variable(limit);need(length,limit);const data=bytes.subarray(position,position+length);position+=length;
    if(metaType===0x2f){if(length!==0)fail('end-of-track meta event must be empty');if(position!==limit)fail('data follows end-of-track');ended=true;break;}
    else if(metaType===0x51){if(length!==3)fail('tempo meta event must contain three bytes');const microsecondsPerQuarter=data[0]*65536+data[1]*256+data[2];if(!microsecondsPerQuarter)fail('tempo cannot be zero');tempoRecords.push({tick,microsecondsPerQuarter,bpm:60000000/microsecondsPerQuarter});}
    else if(metaType===0x58){if(length!==4||data[0]===0||data[1]>7)fail('unsupported or malformed time signature');meterRecords.push({tick,numerator:data[0],denominator:2**data[1],clocksPerClick:data[2],thirtySecondsPerQuarter:data[3]});}
    else if(metaType===3){if(length>1024)fail('track name exceeds 1024 bytes');let name;try{name=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{name=Array.from(data,byte=>String.fromCharCode(byte)).join('');if(!warnings.includes('Non-UTF-8 track names were interpreted as Latin-1.'))warnings.push('Non-UTF-8 track names were interpreted as Latin-1.');}nameEvents.push({tick,name});if(nameEvents.length===1)sourceName=name;}
    else uninterpretedEvents.push({sourceTrackIndex:trackIndex,tick,status,metaType,data:data.slice()});
   }else if(status===0xf0||status===0xf7){runningStatus=null;const length=variable(limit);need(length,limit);uninterpretedEvents.push({sourceTrackIndex:trackIndex,tick,status,data:bytes.slice(position,position+length)});position+=length;}
   else fail('unsupported system status 0x'+status.toString(16));
  }
  if(!ended)fail('track has no end-of-track event');if(openNotes.size)fail('hanging notes remain at end-of-track');durationTicks=Math.max(durationTicks,tick);
  for(const track of channelTracks.values()){track.sourceName=sourceName;track.name=channelTracks.size>1?sourceName+' [channel '+(track.channel+1)+']':sourceName;track.nameEvents=nameEvents.map(e=>({...e}));track.endTick=tick;track.notes.sort((a,b)=>a.startTick-b.startTick||a.pitch-b.pitch||a.id.localeCompare(b.id));tracks.push(track);}
 }
 if(position!==bytes.length)fail('trailing data follows declared MIDI tracks');
 const tempoEvents=timeline(tempoRecords,'tempo'),timeSignatures=timeline(meterRecords,'meter');
 if(tempoEvents.length>1)warnings.push('Tempo changes are retained. Note-only motif extraction does not reproduce the original tempo map.');
 if(timeSignatures.length>1)warnings.push('Meter changes are retained. A fixed project meter does not reproduce the original meter map.');
 if(tracks.some(t=>t.programChanges.some(e=>e.tick>0)))warnings.push('Program changes are retained. A motif using one instrument does not reproduce every program change.');
 if(uninterpretedEvents.length)warnings.push(uninterpretedEvents.length+' uninterpreted events are retained. Note-only extraction does not reproduce pedals, bends, aftertouch, SysEx, or unsupported metadata; sustain does not silently extend notes.');
 checkNoteOverlaps(tracks);
 return {format,ppq,durationTicks,tempoEvents,timeSignatures,tracks,uninterpretedEvents,warnings};
}
function checkNoteOverlaps(tracks){
 const groups=new Map();for(const track of tracks)for(const note of track.notes){const key=(note.channel??track.channel)+':'+note.pitch;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(note);}
 for(const notes of groups.values()){notes.sort((a,b)=>a.startTick-b.startTick||a.durationTicks-b.durationTicks);let end=-1;for(const note of notes){if(note.startTick<end)fail('ambiguous overlapping same-pitch notes on one channel across tracks');end=note.startTick+note.durationTicks;}}
}
function vlq(value){integer(value,0,MAX_TICK,'delta tick');const bytes=[value&127];while((value=Math.floor(value/128))>0)bytes.unshift((value&127)|128);return bytes;}
function meta(type,data){const output=[0xff,type];append(output,vlq(data.length));append(output,data);return output;}
function big32(value){return[(value>>>24)&255,(value>>>16)&255,(value>>>8)&255,value&255];}
function makeTrack(events,endTick){
 const output=[];let previousTick=0;events.sort((a,b)=>a.tick-b.tick||a.priority-b.priority||a.order-b.order);
 for(const event of events){append(output,vlq(event.tick-previousTick));append(output,event.bytes);previousTick=event.tick;}
 append(output,vlq(endTick-previousTick));append(output,[0xff,0x2f,0]);if(output.length>MAX_BYTES)fail('encoded track exceeds byte limit');
 const chunk=[0x4d,0x54,0x72,0x6b];append(chunk,big32(output.length));append(chunk,output);return chunk;
}
export function encodeMidi({ppq=480,bpm=120,tempoEvents,timeSignatures,tracks,durationTicks}={}){
 integer(ppq,1,32767,'PPQN');if(!Number.isFinite(bpm)||bpm<=0)fail('BPM must be finite and positive');const defaultTempo=integer(Math.round(60000000/bpm),1,0xffffff,'tempo microseconds');
 if(!Array.isArray(tracks)||tracks.length>63)fail('export requires an array of at most 63 musical tracks');
 if(tempoEvents!==undefined&&(!Array.isArray(tempoEvents)||tempoEvents.length>MAX_EVENTS))fail('invalid tempo event array');if(timeSignatures!==undefined&&(!Array.isArray(timeSignatures)||timeSignatures.length>MAX_EVENTS))fail('invalid meter event array');
 if((tempoEvents?.length??0)+(timeSignatures?.length??0)>MAX_EVENTS-4)fail('event count exceeds 100000');
 const tempos=timeline((tempoEvents??[]).map(event=>{const tick=integer(event.tick,0,MAX_TICK,'tempo tick'),microsecondsPerQuarter=integer(event.microsecondsPerQuarter??Math.round(60000000/event.bpm),1,0xffffff,'tempo microseconds');return{tick,microsecondsPerQuarter,bpm:60000000/microsecondsPerQuarter};}),'tempo');
 if(tempos[0].implicit)tempos[0]={tick:0,microsecondsPerQuarter:defaultTempo,bpm:60000000/defaultTempo};
 const meters=timeline((timeSignatures??[]).map(event=>{const tick=integer(event.tick,0,MAX_TICK,'meter tick'),numerator=integer(event.numerator,1,255,'meter numerator'),denominator=integer(event.denominator,1,128,'meter denominator');if(!Number.isInteger(Math.log2(denominator)))fail('meter denominator must be a power of two');return {tick,numerator,denominator,clocksPerClick:integer(event.clocksPerClick??24,0,255,'metronome clocks'),thirtySecondsPerQuarter:integer(event.thirtySecondsPerQuarter??8,0,255,'notated thirty-seconds')};}),'meter');
 let order=0;const conductor=[{tick:0,priority:0,order:order++,bytes:meta(3,nameBytes('THREADSCORE conductor'))}];
 for(const event of tempos)conductor.push({tick:event.tick,priority:2,order:order++,bytes:meta(0x51,[(event.microsecondsPerQuarter>>>16)&255,(event.microsecondsPerQuarter>>>8)&255,event.microsecondsPerQuarter&255])});
 for(const event of meters)conductor.push({tick:event.tick,priority:2,order:order++,bytes:meta(0x58,[event.numerator,Math.log2(event.denominator),event.clocksPerClick,event.thirtySecondsPerQuarter])});
 const noteTracks=[],normalizedTracks=[];let totalNotes=0,totalEvents=conductor.length+1,actualEnd=0;if(totalEvents>MAX_EVENTS)fail('event count exceeds 100000');for(const event of conductor)actualEnd=Math.max(actualEnd,event.tick);
 for(let index=0;index<tracks.length;index++){
  const track=tracks[index],channel=integer(track.channel??0,0,15,'channel'),program=integer(track.program??0,0,127,'program');
  if(!Array.isArray(track.notes))fail('each track requires notes');if(totalNotes+track.notes.length>MAX_NOTES)fail('note count exceeds 20000');totalNotes+=track.notes.length;
  const changes=track.programChanges??[];if(!Array.isArray(changes)||changes.length>MAX_EVENTS)fail('invalid program-change array');if(totalEvents+2*track.notes.length+changes.length+3>MAX_EVENTS)fail('event count exceeds 100000');
  const events=[{tick:0,priority:0,order:order++,bytes:meta(3,nameBytes(track.name??'Track '+(index+1)))},{tick:0,priority:2,order:order++,bytes:[0xc0|channel,program]}];
  for(const change of changes){const tick=integer(change.tick,0,MAX_TICK,'program-change tick');events.push({tick,priority:2,order:order++,bytes:[0xc0|channel,integer(change.program,0,127,'program')]});actualEnd=Math.max(actualEnd,tick);}
  const validatedNotes=[];
  for(const note of track.notes){
   if(note.muted)fail('muted notes must be filtered explicitly before MIDI export');
   const startTick=integer(note.startTick,0,MAX_TICK,'note start'),length=integer(note.durationTicks,1,MAX_TICK,'note duration'),endTick=startTick+length;
   if(endTick>MAX_TICK)fail('note end exceeds supported tick limit');
   const pitch=integer(note.pitch,0,127,'pitch'),velocity=integer(note.velocity,1,127,'velocity'),releaseVelocity=integer(note.releaseVelocity??0,0,127,'release velocity');
   if(note.channel!==undefined&&note.channel!==channel)fail('note channel differs from its logical track channel');
   events.push({tick:startTick,priority:3,order:order++,bytes:[0x90|channel,pitch,velocity]},{tick:endTick,priority:1,order:order++,bytes:[0x80|channel,pitch,releaseVelocity]});
   validatedNotes.push({startTick,durationTicks:length,pitch,channel});actualEnd=Math.max(actualEnd,endTick);
  }
  if(track.endTick!==undefined)actualEnd=Math.max(actualEnd,integer(track.endTick,0,MAX_TICK,'track end'));
  normalizedTracks.push({channel,notes:validatedNotes});noteTracks.push(events);totalEvents+=events.length+1;
 }
 checkNoteOverlaps(normalizedTracks);const endTick=durationTicks===undefined?actualEnd:integer(durationTicks,0,MAX_TICK,'score duration');if(endTick<actualEnd)fail('score duration would truncate notes or events');
 const count=noteTracks.length+1,output=[0x4d,0x54,0x68,0x64,0,0,0,6,0,1,(count>>>8)&255,count&255,(ppq>>>8)&255,ppq&255];
 for(const events of [conductor,...noteTracks]){append(output,makeTrack(events,endTick));if(output.length>MAX_BYTES)fail('encoded file exceeds supported byte limit');}return Uint8Array.from(output);
}
