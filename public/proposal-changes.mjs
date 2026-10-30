const node=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
const pitch=p=>['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][((p%12)+12)%12]+(Math.floor(p/12)-1)+' ('+p+')';
export function describeNoteChange(change){
 const parts=[],before=change.before,after=change.after;
 for(const [key,label,format] of [
  ['pitch','Pitch',pitch],['startTick','Start tick',String],['durationTicks','Duration ticks',String],
  ['velocity','Velocity',String],['muted','Sound',v=>v?'rest':'audible']
 ])if(before[key]!==after[key])parts.push(label+': '+format(before[key])+' → '+format(after[key]));
 return parts.join(' · ')||'No note value changes';
}
/** Inspection only: selection stays in the caller-owned Set; never modifies a proposal. */
export function createProposalChanges({host,selectedChanges,onSelectionChange=()=>{},pageSize=100}){
 if(!Number.isInteger(pageSize)||pageSize<1)throw new Error('pageSize must be a positive integer');
 let proposal=null,page=0;
 const controls=node('div','','proposal-review-controls'),searchLabel=node('label','Find changed notes '),search=node('input');
 search.type='search';search.placeholder='Note or passage ID';search.setAttribute('aria-label','Find changed notes by note or passage ID');searchLabel.append(search);
 const passageLabel=node('label','Passage '),passage=node('select');passage.setAttribute('aria-label','Filter changed notes by passage');passageLabel.append(passage);
 const count=node('p','','help'),rows=node('div','','proposal-review-rows'),navigation=node('div','','proposal-review-navigation');
 count.setAttribute('role','status');count.setAttribute('aria-live','polite');
 const previous=node('button','Previous page'),next=node('button','Next page');previous.type=next.type='button';
 const jump=node('select');jump.setAttribute('aria-label','Change page');
 const selectPage=node('button','Select this page'),clearPage=node('button','Clear this page'),clearAll=node('button','Clear selection');
 for(const b of [selectPage,clearPage,clearAll])b.type='button';
 navigation.append(jump,previous,next,selectPage,clearPage,clearAll);controls.append(searchLabel,passageLabel);host.replaceChildren(controls,count,rows,navigation);
 let filtered=[],start=0,end=0;
 function updateCount(){
  const total=proposal?.diff.length||0;
  selectPage.disabled=start===end||filtered.slice(start,end).every(d=>selectedChanges.has(d.noteId));
  clearPage.disabled=!filtered.slice(start,end).some(d=>selectedChanges.has(d.noteId));
  clearAll.disabled=!selectedChanges.size;
  count.textContent=(filtered.length?'Showing '+(start+1)+'–'+end+' of '+filtered.length+' matching changes':'No matching changes')+' · '+total+' total changes · '+selectedChanges.size+' selected across all pages and filters.';
 }
 function render(){
  const diff=proposal?.diff||[],query=search.value.trim().toLowerCase();
  filtered=diff.filter(d=>(!passage.value||d.after.occurrenceId===passage.value)&&(!query||[d.noteId,d.after.occurrenceId,d.after.sourceNoteId].join(' ').toLowerCase().includes(query)));
  page=Math.min(Math.max(0,page),Math.max(0,Math.ceil(filtered.length/pageSize)-1));start=page*pageSize;end=Math.min(start+pageSize,filtered.length);
  rows.replaceChildren();
  for(const d of filtered.slice(start,end)){
   const label=node('label','','change-row'),input=node('input'),text=node('span');input.type='checkbox';input.dataset.noteId=d.noteId;input.checked=selectedChanges.has(d.noteId);
   input.addEventListener('change',()=>{if(input.checked)selectedChanges.add(d.noteId);else selectedChanges.delete(d.noteId);updateCount();onSelectionChange(selectedChanges);});
   text.append(node('strong',d.after.occurrenceId+' / '+d.after.sourceNoteId),node('small',describeNoteChange(d)));label.append(input,text);rows.append(label);
  }
  jump.replaceChildren();const pages=Math.ceil(filtered.length/pageSize);
  for(let i=0;i<pages;i++){const option=node('option','Page '+(i+1)+' of '+pages);option.value=String(i);jump.append(option);}
  jump.value=String(page);jump.disabled=!pages;
  previous.disabled=page===0;next.disabled=end>=filtered.length;updateCount();
 }
 function bulk(action){
  if(action==='all')selectedChanges.clear();
  else for(const d of filtered.slice(start,end)){if(action==='select')selectedChanges.add(d.noteId);else selectedChanges.delete(d.noteId);}
  for(const input of rows.querySelectorAll('input[type=checkbox]'))input.checked=selectedChanges.has(input.dataset.noteId);
  updateCount();onSelectionChange(selectedChanges);
 }
 selectPage.addEventListener('click',()=>bulk('select'));clearPage.addEventListener('click',()=>bulk('clear'));clearAll.addEventListener('click',()=>bulk('all'));
 jump.addEventListener('change',()=>{page=Number(jump.value);render();});
 search.addEventListener('input',()=>{page=0;render();});passage.addEventListener('change',()=>{page=0;render();});
 previous.addEventListener('click',()=>{page--;render();});next.addEventListener('click',()=>{page++;render();});
 function setProposal(value){
  if(value!==proposal){
   proposal=value;page=0;search.value='';passage.replaceChildren();const all=node('option','All passages');all.value='';passage.append(all);
   for(const id of new Set((proposal?.diff||[]).map(d=>d.after.occurrenceId))){const option=node('option',id);option.value=id;passage.append(option);}
   passage.value='';
  }
  render();
 }
 setProposal(null);
 return {setProposal,render};
}
