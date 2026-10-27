import {createZip} from '../src/zip.mjs';
import {readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join,relative,extname} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=['README.md','LICENSE','CONTRIBUTING.md','package.json','server.mjs'];
async function collect(directory,extensions){
 let items;try{items=await readdir(join(root,directory),{withFileTypes:true});}catch(error){if(error.code==='ENOENT'&&directory==='docs')return;throw error;}
 for(const entry of items.sort((a,b)=>a.name.localeCompare(b.name))){
  if(entry.name.startsWith('.'))continue;
  const name=directory+'/'+entry.name;
  if(entry.isSymbolicLink())throw Error('Package refuses symbolic links: '+name);
  if(entry.isDirectory())await collect(name,extensions);
  else if(entry.isFile()&&extensions.has(extname(entry.name)))files.push(name);
 }
}
for(const directory of ['src','tests','tools','evaluation'])await collect(directory,new Set(['.mjs']));
await collect('public',new Set(['.mjs','.html','.css','.svg','.png']));
await collect('docs',new Set(['.md','.png','.svg']));
let sourceCommit=null,sourceDirty=null;
try{
 const top=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 if(top===root){sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();sourceDirty=execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8'}).trim().length>0;}
}catch{}
const manifest={format:'threadscore-source-package',version:1,sourceCommit,sourceDirty,files:[]},entries=[];
for(const name of files.sort()){
 const path=join(root,name),stat=await lstat(path);
 if(!stat.isFile()||stat.isSymbolicLink()||relative(root,path).startsWith('..'))throw Error('Unsafe package source: '+name);
 const data=await readFile(path);
 manifest.files.push({path:name,bytes:data.length,sha256:sha256(data)});
 entries.push({name:'threadscore/'+name,data});
}
entries.push({name:'threadscore/SOURCE-MANIFEST.json',data:new TextEncoder().encode(JSON.stringify(manifest,null,2)+'\n')});
const bytes=createZip(entries),out=join(root,'dist','threadscore-0.1.0.zip');
await mkdir(dirname(out),{recursive:true});await writeFile(out,bytes);
console.log(JSON.stringify({file:out,bytes:bytes.length,sha256:sha256(bytes),files:entries.length,sourceCommit,sourceDirty},null,2));
