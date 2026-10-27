const table=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const value of bytes)crc=table[(crc^value)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
export function createZip(entries){
 if(!Array.isArray(entries)||entries.length<1||entries.length>1000)throw Error('ZIP requires one to one thousand entries.');
 const local=[],central=[],names=new Set();let offset=0,centralLength=0,total=0;
 for(const entry of entries){
  if(typeof entry.name!=='string'||!entry.name||entry.name.startsWith('/')||entry.name.includes('\\')||entry.name.split('/').some(p=>p==='..'||p==='.')||names.has(entry.name)||!(entry.data instanceof Uint8Array))throw Error('ZIP entries need unique safe relative names and bytes.');
  names.add(entry.name);const name=new TextEncoder().encode(entry.name),data=entry.data;total+=data.length;if(name.length>65535||total>256*1024*1024)throw Error('ZIP exceeds the package bounds.');
  const crc=crc32(data),header=new Uint8Array(30+name.length),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(12,33,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);header.set(name,30);local.push(header,data);
  const directory=new Uint8Array(46+name.length),d=new DataView(directory.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);directory.set(name,46);central.push(directory);centralLength+=directory.length;offset+=header.length+data.length;
 }
 const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,centralLength,true);e.setUint32(16,offset,true);
 const result=new Uint8Array(offset+centralLength+end.length);let position=0;for(const part of [...local,...central,end]){result.set(part,position);position+=part.length;}return result;
}
