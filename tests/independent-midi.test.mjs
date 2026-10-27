import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMidi,encodeMidi} from '../src/midi.mjs';
const ascii=s=>Array.from(s,c=>c.charCodeAt(0)),u16=n=>[(n>>>8)&255,n&255],u32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255],eot=[0,0xff,0x2f,0];
function midiFile(track,{format=0,division=480}={}){return Uint8Array.from([...ascii('MThd'),...u32(6),...u16(format),...u16(1),...u16(division),...ascii('MTrk'),...u32(track.length),...track]);}
const note=(startTick,durationTicks,pitch,velocity=90,channel=0)=>({startTick,durationTicks,pitch,velocity,channel});
function actualNotes(parsed){return parsed.tracks.flatMap(t=>t.notes.map(n=>[n.channel,n.startTick,n.durationTicks,n.pitch,n.velocity])).sort((a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;});}
const expectedNotes=tracks=>actualNotes({tracks:tracks.map(t=>({...t,notes:t.notes.map(n=>({...n,channel:n.channel??t.channel??0}))}))});
test('independent MIDI: real format1 bytes preserve polyphony, channels, tempo map and note durations',()=>{
 const tracks=[{name:'Thread A',channel:0,program:40,notes:[note(0,480,60,91),note(240,720,67,72)]},{name:'Thread B',channel:2,program:10,notes:[note(120,240,50,66,2),note(960,480,57,83,2)]}],tempoEvents=[{tick:0,microsecondsPerQuarter:500000},{tick:960,microsecondsPerQuarter:1000000}],timeSignatures=[{tick:0,numerator:4,denominator:4}];
 const encoded=encodeMidi({ppq:480,bpm:120,tempoEvents,timeSignatures,tracks,durationTicks:1920});assert.ok(encoded instanceof Uint8Array);assert.equal(String.fromCharCode(...encoded.slice(0,4)),'MThd');const parsed=parseMidi(encoded);assert.equal(parsed.format,1);assert.equal(parsed.ppq,480);assert.deepEqual(actualNotes(parsed),expectedNotes(tracks));assert.deepEqual(parsed.tempoEvents.map(t=>[t.tick,t.microsecondsPerQuarter]),[[0,500000],[960,1000000]]);assert.ok(parsed.timeSignatures.some(t=>t.tick===0&&t.numerator===4&&t.denominator===4));const sounding=parsed.tracks.filter(t=>t.notes.length);assert.equal(sounding.length,2);assert.ok(sounding.every(t=>t.endTick===1920));assert.deepEqual(sounding.map(t=>[t.channel,t.program]).sort((a,b)=>a[0]-b[0]),[[0,40],[2,10]]);assert.deepEqual(actualNotes(parseMidi(encodeMidi({ppq:parsed.ppq,tempoEvents:parsed.tempoEvents,timeSignatures:parsed.timeSignatures,tracks:sounding,durationTicks:1920}))),actualNotes(parsed));
});
test('independent MIDI: adjacent same-pitch notes survive explicit off-before-on ordering',()=>{
 const tracks=[{channel:0,notes:[note(0,480,60,80),note(480,240,60,100),note(720,120,60,60)]}];assert.deepEqual(actualNotes(parseMidi(encodeMidi({ppq:480,bpm:120,tracks,durationTicks:960}))),expectedNotes(tracks));
});
test('independent MIDI: handmade running-status input and velocity-zero NoteOn close actual notes',()=>{
 const parsed=parseMidi(midiFile([0,0xc2,41,0,0x92,60,100,120,64,80,120,60,0,0,64,0,...eot]));assert.deepEqual(actualNotes(parsed),[[2,0,240,60,100],[2,120,120,64,80]]);assert.equal(parsed.tracks.find(t=>t.notes.length).program,41);
});
test('independent MIDI: one physical track with two channels becomes two logical tracks',()=>{
 const parsed=parseMidi(midiFile([0,0xc0,5,0,0xc1,6,0,0x90,60,90,0,0x91,67,70,0x81,0x70,0x80,60,0,0x81,0x70,0x81,67,0,...eot])),sounding=parsed.tracks.filter(t=>t.notes.length);assert.equal(sounding.length,2);assert.deepEqual(actualNotes(parsed),[[0,0,240,60,90],[1,0,480,67,70]]);assert.ok(sounding.every(t=>t.sourceTrackIndex===0));assert.deepEqual(sounding.map(t=>[t.channel,t.program]).sort((a,b)=>a[0]-b[0]),[[0,5],[1,6]]);
});
test('independent MIDI: unsupported format and SMPTE timing are rejected explicitly',()=>{assert.throws(()=>parseMidi(midiFile(eot,{format:2})));assert.throws(()=>parseMidi(midiFile(eot,{division:0xe728})));});
test('independent MIDI: malformed, ambiguous and hanging-note inputs cannot produce partial success',()=>{
 const valid=midiFile([0,0x90,60,80,120,0x80,60,0,...eot]);const cases=[valid.slice(0,valid.length-1),midiFile([0,0x90,60,80,...eot]),midiFile([0,0x90,60,80,120,0x90,60,90,120,0x80,60,0,0,0x80,60,0,...eot]),midiFile([0x81,0x80,0x80,0x80,0,0x90,60,80,...eot])];cases.forEach((bytes,i)=>assert.throws(()=>parseMidi(bytes),'case '+i));assert.throws(()=>parseMidi(valid,{maxBytes:8}));
});
test('independent MIDI: expressive pedal data is retained and warned about without inventing sustain extension',()=>{
 const parsed=parseMidi(midiFile([0,0x90,60,90,0,0xb0,64,127,0x83,0x60,0x80,60,0,0x83,0x60,0xb0,64,0,...eot]));assert.deepEqual(actualNotes(parsed),[[0,0,480,60,90]]);assert.ok(parsed.uninterpretedEvents.length>=2);assert.ok(parsed.warnings.length>0);
});
test('independent MIDI: impossible export values are rejected rather than clipped or shortened',()=>{
 for(const bad of [note(0,480,128),note(0,0,60),note(-1,480,60),note(0,480,60,0),note(.5,480,60)])assert.throws(()=>encodeMidi({ppq:480,tracks:[{channel:0,notes:[bad]}]}));assert.throws(()=>encodeMidi({ppq:480,tracks:[{channel:0,notes:[note(0,480,60,90,1)]}]}));assert.throws(()=>encodeMidi({ppq:480,tracks:[{channel:0,notes:[note(0,480,60)]}],durationTicks:240}));
});
test('independent MIDI: running status resumes after an intervening track-name meta event',()=>{
 const parsed=parseMidi(midiFile([0,0x90,60,90,0,0xff,0x03,1,0x41,120,60,0,...eot]));assert.deepEqual(actualNotes(parsed),[[0,0,120,60,90]]);
});
