import {clamp,newId,utf8ToBase64,base64ToUtf8,normalizeNote,popupCoordinates,makeActions,printableName,pdfGlyphAdvances,matchPdfGlyphGeometry} from './core.js';
import {initGitHubLibrary} from './github-library.js';
const $ = id => document.getElementById(id);
let pdfjs = null;
const state = { pdf:null, bytes:null, fileName:'', page:1, zoom:.9, zoomFit:false, notes:[], marks:[], history:[], historyIndex:-1, editingId:null, pendingPoint:null, placing:false, openedPopup:null, pinned:false, renderJob:null, textLayerTask:null, selectionMode:true, locked:false, originals:0, oldWidgets:0, markColors:{primary:'#baf6ff',secondary:'#ffeaa7',underline:'#ff0000'}, markOpacity:.42, solidShortcuts:false, quickToolbarEnabled:false };
const el = {canvas:$('pdf-canvas'),pageContainer:$('page-container'),notesLayer:$('notes-layer'), existingLayer:$('existing-layer'),textLayer:$('text-layer'),marksLayer:$('burned-marks-layer'),selectionLayer:$('pdf-selection-layer'),stage:$('pdf-stage'),scroll:$('viewport-scroll'),editor:$('rich-editor')};
let toastTimer, hideTimer, renderSequence = 0, selectedMedia = null, savedPdfRange = null, pdfSelectionDrag = null, quickMarkGesture = null;
let githubLibrary=null, savedSnapshot='';
const editorSnapshot=()=>JSON.stringify({notes:state.notes,marks:state.marks});
// Source PDF text-item metrics anchor marks even when a fallback browser font differs.
let pdfTextGeometry = new WeakMap();
// Reuse PDF glyph advances across zoom changes; keep only a few recent pages.
let pdfGlyphCache = new Map();
function showToast(message, timeout=4500) {const node=$('toast');node.textContent=message;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),timeout)}
function status(message) {$('status-text').textContent=message;}
function busy(yes,msg) {state.locked=yes;$('btn-export').disabled=yes||!state.pdf;$('btn-add').disabled=yes||!state.pdf;if(msg)status(msg);}
function verifyLib() {if(!window.PDFLib) throw new Error('A biblioteca pdf-lib não carregou. Verifique a conexão com a Internet.');if(!window.html2canvas)throw new Error('A biblioteca html2canvas não carregou. Verifique a conexão.');}
async function loadPDFJs() {
 if (pdfjs) return pdfjs;
 try {pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs');
 pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs';return pdfjs;}
 catch (e){throw new Error('Não foi possível carregar PDF.js pela Internet. '+e.message)}
}
async function readProject(bytes,totalPages) {
 try {
 const {PDFDocument,PDFName} = window.PDFLib;
 const lib = await PDFDocument.load(bytes,{updateMetadata:false,ignoreEncryption:false});
 const entry = lib.catalog.lookup(PDFName.of('NPSData'));
 if(!entry || typeof entry.decodeText!=='function') return [];
 const project=JSON.parse(base64ToUtf8(entry.decodeText()));
 if(![1,2].includes(project.version) || !Array.isArray(project.notes)) return [];
 return project.notes.map(n=>normalizeNote(n,totalPages)).filter(Boolean);
 } catch(err) {console.warn('Metadados de notas não carregados',err);return []}
}
async function openPdf(file, source=null){
 hideQuickMarkToolbar();
 if(!file) return; busy(true,'Lendo o documento…');
 try {
   verifyLib();const pjs=await loadPDFJs();
   const bytes=new Uint8Array(await file.arrayBuffer());
   const task=pjs.getDocument({data:bytes.slice(),useSystemFonts:true});
   const doc=await task.promise;
   if(state.pdf){try{await state.pdf.destroy()}catch{}}
   state.pdf=doc;state.bytes=bytes;state.fileName=file.name||'documento.pdf';state.page=1;state.zoom=.9;state.zoomFit=false;state.marks=[];pdfGlyphCache.clear();state.notes=await readProject(bytes,doc.numPages);state.history=[];state.historyIndex=-1;pushHistory();
   state.openedPopup=null;state.originals=0;stopPlacement();
   $('file-name').textContent=state.fileName;$('file-size').textContent=(bytes.length/1048576).toFixed(1)+' MB';$('doc-detail').textContent=doc.numPages+' páginas · '+state.notes.length+' notas deste editor';
   $('total-pages').textContent='/ '+doc.numPages;$('page-number').max=doc.numPages;
   $('empty-state').classList.add('hidden');el.stage.classList.remove('hidden');
   for(const id of ['btn-add','btn-export','page-number','prev-page','next-page','zoom-out','zoom-in','fit-width'])$(id).disabled=false;
   syncPageNavigation();await renderPage();
   if(!source)githubLibrary?.setActive(null);
   savedSnapshot=editorSnapshot();
   showToast('PDF aberto em 90%. Seus comentários originais foram mantidos.');
 }catch(err){console.error(err);showToast(err.message,6500);status('Falha ao abrir: '+err.message);return false}finally{busy(false)}
}
async function fitWidth(){if(!state.pdf)return;const p=await state.pdf.getPage(state.page);const view=p.getViewport({scale:1});state.zoom=clamp((el.scroll.clientWidth-85)/view.width,.40,1.8);state.zoomFit=true;await renderPage()}
function syncPageNavigation(){
 const prevDisabled=!state.pdf||state.page<=1, nextDisabled=!state.pdf||state.page>=state.pdf.numPages;
 for(const id of ['prev-page','fs-prev-page'])$(id).disabled=prevDisabled;
 for(const id of ['next-page','fs-next-page'])$(id).disabled=nextDisabled;
}
function setPage(n){
 if(!state.pdf)return;
 const target=Number(n);
 if(!Number.isSafeInteger(target)||target<1){
  $('page-number').value=state.page;return;
 }
 state.page=clamp(target,1,state.pdf.numPages);state.openedPopup=null;
 $('page-number').value=state.page;
 syncPageNavigation();renderPage();
}
function commitPageNumber(){
 const input=$('page-number'),raw=input.value.trim();
 if(!/^\d+$/.test(raw)){input.value=state.page;return;}
 setPage(Number(raw));
}

async function renderPage(){
 hideQuickMarkToolbar();
 if(!state.pdf)return;const seq=++renderSequence;
 try{
  status('Renderizando página '+state.page+'…');
  if(state.renderJob){try{state.renderJob.cancel()}catch{}}
  if(state.textLayerTask){try{state.textLayerTask.cancel()}catch{}state.textLayerTask=null;}
  savedPdfRange=null;pdfTextGeometry=new WeakMap();el.selectionLayer.replaceChildren();
  const page=await state.pdf.getPage(state.page);if(seq!==renderSequence)return;
  const view=page.getViewport({scale:state.zoom});state.currentViewport=view;const ratio=Math.min(window.devicePixelRatio||1,2);
  el.canvas.width=Math.ceil(view.width*ratio);el.canvas.height=Math.ceil(view.height*ratio);
  el.canvas.style.width=view.width+'px';el.canvas.style.height=view.height+'px';
  el.pageContainer.style.width=view.width+'px';el.pageContainer.style.height=view.height+'px';
  $('page-number').value=state.page;$('zoom-label').textContent=Math.round(state.zoom*100)+'%';
  $('viewer-label').textContent='Página '+state.page;
  const ctx=el.canvas.getContext('2d',{alpha:false});ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,el.canvas.width,el.canvas.height);
  state.renderJob=page.render({canvasContext:ctx,viewport:view,transform:[ratio,0,0,ratio,0,0],annotationMode:0});
  await state.renderJob.promise;if(seq!==renderSequence)return;
  await buildTextLayer(page,view,seq);
  const old = await page.getAnnotations({intent:'display'});if(seq!==renderSequence)return;
  drawOriginalAnnotations(old,view);drawBurnedMarks(view);drawNotes(view);drawNoteList(old);
   syncPageNavigation();
  $('doc-detail').textContent=state.pdf.numPages+' páginas · '+state.notes.length+' notas deste editor';
  status('Página '+state.page+' de '+state.pdf.numPages+' · '+old.length+' anotações originais nesta página');
 }catch(err){if(err.name==='RenderingCancelledException')return;console.error(err);status('Erro ao renderizar: '+err.message);showToast('Erro de renderização: '+err.message)}
}
function annotationColor(color,fallback='#ffeaa7'){
 let values;
 if(!color){
  const hex=String(fallback).replace('#','');
  values=/^[0-9a-f]{6}$/i.test(hex)?[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)):[255,234,167];
 }else if(typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color)){
  const hex=color.slice(1);values=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));
 }else values=Array.from(color);
 if(values.length===1)values=[values[0],values[0],values[0]];
 if(values.length<3)values=[255,234,167];
 if(Math.max(...values.slice(0,3))<=1)values=values.map(v=>v*255);
 const [r,g,b]=values.slice(0,3).map(v=>Math.max(0,Math.min(255,Math.round(Number(v)||0))));
 return {rgb:`rgb(${r}, ${g}, ${b})`,rgba:(alpha)=>`rgba(${r}, ${g}, ${b}, ${alpha})`,hex:'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('')};
}
function annotationQuads(annotation){
 const raw=annotation.quadPoints;
 if(raw&&raw.length){
  const first=raw[0];
  if(Array.isArray(first)||ArrayBuffer.isView(first)){
   return Array.from(raw).map(q=>Array.from(q)).filter(q=>q.length>=8).map(q=>q.slice(0,8));
  }
  const flat=Array.from(raw),quads=[];
  for(let i=0;i+7<flat.length;i+=8)quads.push(flat.slice(i,i+8));
  if(quads.length)return quads;
 }
 return [];
}
function drawOriginalAnnotations(annotations,view){
 el.existingLayer.replaceChildren();
 for(const a of annotations){
  if(!a.rect || !Array.isArray(a.rect))continue;
  const subtype=String(a.subtype||'').toLowerCase();
  if(!['highlight','underline','text','freetext','squiggly','strikeout'].includes(subtype))continue;
  const quads=annotationQuads(a);
  const rects=quads.length?quads.map(q=>{
   const xs=[q[0],q[2],q[4],q[6]],ys=[q[1],q[3],q[5],q[7]];
   return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
  }):[a.rect];
  const fallback=subtype==='underline'||subtype==='strikeout'?'#000000':'#ffeaa7';
  const color=annotationColor(a.color,fallback);
  for(const rect of rects){
   if(!rect||rect.length<4)continue;
   const vr=view.convertToViewportRectangle(rect);const x=Math.min(vr[0],vr[2]),y=Math.min(vr[1],vr[3]);
   const w=Math.abs(vr[2]-vr[0]),h=Math.abs(vr[3]-vr[1]);
   if(!w||!h)continue;
   const node=document.createElement('div');
   node.className='old-annotation '+(subtype==='highlight'?'highlight':subtype==='underline'?'underline':subtype==='text'?'sticky':subtype==='strikeout'?'strikeout':subtype==='squiggly'?'squiggly':'');
   node.style.cssText=`left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
   if(subtype==='highlight'){
    const alpha=Number.isFinite(Number(a.opacity))&&Number(a.opacity)>0&&Number(a.opacity)<1?Number(a.opacity):.42;
    node.style.backgroundColor=color.rgba(alpha);
    node.dataset.annotationColor=color.hex;
   }else if(subtype==='underline'){
    node.style.borderBottomColor=color.rgb;
    node.dataset.annotationColor=color.hex;
   }else if(subtype==='strikeout'){
    node.style.background=`linear-gradient(transparent calc(50% - 1px), ${color.rgb} calc(50% - 1px), ${color.rgb} calc(50% + 1px), transparent calc(50% + 1px))`;
   }else if(subtype==='squiggly'){
    node.style.borderBottom=`2px wavy ${color.rgb}`;
   }else if(subtype==='text')node.textContent='✎';
   const t=[a.titleObj?.str||a.title||'',a.contentsObj?.str||a.contents||''].filter(Boolean).join('\n');
   if(t)node.title=t;
   el.existingLayer.append(node);
  }
 }
}
function drawNoteList(old){
 const list=$('note-list');list.replaceChildren();
 const ours=state.notes.filter(n=>n.page===state.page);
 $('notes-count').textContent=String(ours.length);
 for(const n of ours){
 const btn=document.createElement('button');btn.type='button';btn.className='note-row'+(state.openedPopup===n.id?' active':'');
 const s=document.createElement('span');s.className='note-symbol';s.textContent='▤';
 const main=document.createElement('span');const strong=document.createElement('strong');strong.textContent=n.title;const small=document.createElement('small');small.textContent='Nota com texto / imagem · editar';main.append(strong,small);btn.append(s,main);
 btn.addEventListener('click',()=>openEditor(n.id));list.append(btn);
 }
 if(!ours.length){const placeholder=document.createElement('div');placeholder.className='empty-notes';placeholder.textContent=old.length?`Esta página possui ${old.length} anotações originais. Use “Nova nota” para acrescentar uma.`:'Clique em “Nova nota” para começar.';list.append(placeholder)}
}
function drawNotes(view){
 el.notesLayer.replaceChildren();
 for(const n of state.notes.filter(n=>n.page===state.page)){
  const x=n.x*view.width,y=n.y*view.height;
  const mark=document.createElement('button');mark.className='note-marker';mark.title=n.title+' · clique para abrir / fixar';mark.textContent='▤';
  mark.style.left=x+'px';mark.style.top=y+'px';
  mark.addEventListener('mouseenter',()=>{clearTimeout(hideTimer);if(n.hover&&!state.pinned)openPopup(n,view,false)});
  mark.addEventListener('mouseleave',()=>{if(!state.pinned)hideTimer=setTimeout(closePopup,220)});
  mark.addEventListener('click',e=>{e.preventDefault();if(state.openedPopup===n.id&&state.pinned){state.pinned=false;closePopup()}else{state.pinned=true;openPopup(n,view,true)}});
  mark.addEventListener('contextmenu',e=>{e.preventDefault();openEditor(n.id)});
  el.notesLayer.append(mark);
 }
 if(state.openedPopup){const n=state.notes.find(x=>x.id===state.openedPopup);if(n)openPopup(n,view,state.pinned)}
}
function closePopup(){if(state.pinned)return;el.notesLayer.querySelectorAll('.note-popup').forEach(x=>x.remove());state.openedPopup=null}
function safeHTML(html){
 // Accept formatting only. Reject event handlers, scripts, external URLs, and unsafe CSS.
 const temp=document.createElement('template');temp.innerHTML=String(html||'');
 const allowed=new Set(['P','DIV','SPAN','BR','B','STRONG','I','EM','U','S','STRIKE','FONT','UL','OL','LI','BLOCKQUOTE','H1','H2','H3','TABLE','THEAD','TBODY','TR','TD','TH','HR','IMG']);
 function clean(parent){for(const node of [...parent.childNodes]){
   if(node.nodeType===8){node.remove();continue}if(node.nodeType!==1)continue;
   if(!allowed.has(node.tagName)){if(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','VIDEO','AUDIO','FORM'].includes(node.tagName)){node.remove();continue;}clean(node);node.replaceWith(...node.childNodes);continue;}
   for(const attr of [...node.attributes]){
    let keep=false;
    if(attr.name==='style'){
      const safe=new Set(['color','background-color','font-family','font-size','font-weight','font-style','text-align','text-decoration','width','height','border','border-color','border-width','border-style','vertical-align','margin','margin-left','margin-right','padding','line-height']);
      for(const p of [...node.style])if(!safe.has(p)||/url\s*\(|expression\s*\(|var\s*\(/i.test(node.style.getPropertyValue(p)))node.style.removeProperty(p);
      keep=true;
    }
    if(node.tagName==='IMG'&&attr.name==='src')keep=/^data:image\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(attr.value);
    if(node.tagName==='SPAN'&&attr.name==='class')keep=['media-frame','media-handle'].includes(attr.value);
    if(node.tagName==='SPAN'&&attr.name==='contenteditable')keep=attr.value==='false'&&['media-frame','media-handle'].includes(node.className);
    if(node.tagName==='FONT'&&['color','face','size'].includes(attr.name))keep=true;
    if((node.tagName==='TD'||node.tagName==='TH')&&['colspan','rowspan'].includes(attr.name))keep=/^\d{1,2}$/.test(attr.value);
    if(!keep)node.removeAttribute(attr.name);
   }
   clean(node);
 }}clean(temp.content);
 return temp.innerHTML;
}
function openPopup(n,view,pin){
 clearTimeout(hideTimer);el.notesLayer.querySelectorAll('.note-popup').forEach(x=>x.remove());
 state.openedPopup=n.id;state.pinned=pin;
 const w=Math.min(n.width*state.zoom,view.width-14),maxH=view.height-14;
 const x=n.x*view.width,y=n.y*view.height;
 const left=clamp(x-w-16,7,Math.max(7,view.width-w-7));
 const pop=document.createElement('div');pop.className='note-popup';pop.style.cssText=`left:${left}px;top:7px;width:${w}px;max-height:${maxH}px;background:${n.bg};border-color:${n.border};`;
 const header=document.createElement('div');header.className='popup-header';const title=document.createElement('span');title.textContent=n.title;
 const actions=document.createElement('span');const edit=document.createElement('button');edit.className='popup-edit';edit.textContent='Editar';edit.addEventListener('click',()=>openEditor(n.id));
 const close=document.createElement('button');close.textContent='×';close.title='Fechar';close.addEventListener('click',()=>{state.pinned=false;closePopup()});actions.append(edit,close);header.append(title,actions);
 const body=document.createElement('div');body.className='popup-body';body.innerHTML=safeHTML(n.html);applyNoteSpacing(body,n.lineSpacing,n.paragraphSpacing);
 pop.append(header,body);el.notesLayer.append(pop);
 // Measure the natural content height, then cap it to the visible PDF page. Scrolling stays inside the note.
 const natural=Math.ceil(header.offsetHeight+body.scrollHeight+4);
 const h=Math.min(Math.max(90,natural),maxH);
 let top=clamp(y-h/2,7,Math.max(7,view.height-h-7));
 pop.style.top=top+'px';pop.style.height=h+'px';pop.style.overflow='hidden';
 body.style.height=Math.max(0,h-header.offsetHeight-4)+'px';body.style.maxHeight='none';body.style.overflowY=natural>h?'auto':'hidden';
 body.querySelectorAll('img').forEach(img=>{img.addEventListener('click',()=>img.classList.toggle('image-expanded'));img.decode?.().then(()=>{if(!pop.isConnected)return;const naturalNow=header.offsetHeight+body.scrollHeight+4;const newH=Math.min(Math.max(90,naturalNow),maxH);pop.style.height=newH+'px';pop.style.top=clamp(y-newH/2,7,Math.max(7,view.height-newH-7))+'px';body.style.height=Math.max(0,newH-header.offsetHeight-4)+'px';body.style.overflowY=naturalNow>newH?'auto':'hidden';}).catch(()=>{});});
 pop.addEventListener('mouseenter',()=>clearTimeout(hideTimer));pop.addEventListener('mouseleave',()=>{if(!state.pinned)hideTimer=setTimeout(closePopup,180)});
}

function startPlacement(){
 hideQuickMarkToolbar();
 if(!state.pdf||state.locked)return;
 state.placing=!state.placing;
 el.pageContainer.classList.toggle('placing',state.placing);
 $('placement-hint').classList.toggle('hidden',!state.placing);
 $('btn-add').textContent=state.placing?'✕ Cancelar':'＋ Nova nota';
 $('btn-add').setAttribute('aria-pressed',String(state.placing));
 showToast(state.placing?'Clique em um ponto da página para abrir o editor de notas.':'Posicionamento cancelado.',3500);
}

function stopPlacement(){
 state.placing=false;el.pageContainer.classList.remove('placing');
 $('placement-hint').classList.add('hidden');$('btn-add').textContent='＋ Nova nota';
 $('btn-add').setAttribute('aria-pressed','false');
}
function openEditor(id=null){
 hideQuickMarkToolbar();
 if(!state.pdf)return;stopPlacement();const n=id?state.notes.find(x=>x.id===id):null;
 state.editingId=n?.id||null;savedRange=null;
 $('editor-heading').textContent=n?'Editar nota':'Criar nota';$('note-delete').classList.toggle('hidden',!n);
 $('note-title').value=n?.title||'Nota explicativa';el.editor.innerHTML=safeHTML(n?.html||'<p>Escreva aqui o conteúdo da sua anotação.</p>');
 updateColorButton('text');updateColorButton('highlight');closeColorPalettes();
 $('line-spacing').value=String(n?.lineSpacing??1);
 $('paragraph-spacing').value=String(n?.paragraphSpacing??0);
 updateEditorSpacing();
 $('note-bg').value=n?.bg||'#fffdf4';$('note-border').value=n?.border||'#c7b18a';
 $('popup-width').value=n?.width||340;
 $('trigger-hover').checked=n?.hover!==false;$('trigger-click').checked=n?.click!==false;
 updateRangeOutputs();$('dialog-backdrop').classList.remove('hidden');
 setTimeout(()=>el.editor.focus(),60);
}
function closeEditor(){$('dialog-backdrop').classList.add('hidden');selectedMedia=null;savedRange=null;closeColorPalettes()}
function updateRangeOutputs(){$('width-out').textContent=$('popup-width').value+' px'}
function applyNoteSpacing(node,lineSpacing,paragraphSpacing){
 const line=Number(lineSpacing),after=Number(paragraphSpacing);
 node.style.setProperty('--note-line-spacing',String([1,1.15,1.5,1.55,2].includes(line)?line:1));
 node.style.setProperty('--note-paragraph-spacing',String([0,4,8].includes(after)?after:0)+'px');
}
function updateEditorSpacing(){applyNoteSpacing(el.editor,$('line-spacing').value,$('paragraph-spacing').value)}
function saveEditor(){
 if(!state.pdf)return;const current=state.editingId?state.notes.find(x=>x.id===state.editingId):null;
 const obj={id:current?.id||newId(),page:current?.page||state.page,x:current?.x??state.pendingPoint?.x??.88,y:current?.y??state.pendingPoint?.y??.12,
 title:$('note-title').value.trim()||'Nota',html:safeHTML(el.editor.innerHTML),bg:$('note-bg').value,border:$('note-border').value,
 width:+$('popup-width').value,lineSpacing:+$('line-spacing').value,paragraphSpacing:+$('paragraph-spacing').value,hover:$('trigger-hover').checked,click:$('trigger-click').checked};
 const newNote=normalizeNote(obj,state.pdf.numPages);
 pushHistory();
 if(current)state.notes=state.notes.map(n=>n.id===current.id?newNote:n);else state.notes.push(newNote);
 pushHistory();
 state.pendingPoint=null;closeEditor();state.openedPopup=null;state.pinned=false;renderPage();showToast(githubLibrary?.hasActive()?'Nota salva no editor. Clique em “Salvar no GitHub” para atualizar o PDF.':'Nota salva no editor. Clique em “Salvar PDF” para baixar.');
}
function selectionSave(){const sel=window.getSelection();if(sel&&sel.rangeCount&&el.editor.contains(sel.anchorNode))return sel.getRangeAt(0).cloneRange();return null}
let savedRange=null;
function restoreSelection(){if(!savedRange)return;const sel=window.getSelection();sel.removeAllRanges();sel.addRange(savedRange)}
function cmd(command,value=null){el.editor.focus();restoreSelection();document.execCommand(command,false,value);savedRange=selectionSave();}
function insertHTML(html){el.editor.focus();restoreSelection();document.execCommand('insertHTML',false,html);savedRange=selectionSave();}
// Word-style two-part controls: main button repeats last color; arrow opens palette.
const editorColors={text:'#000000',highlight:'#fff1a8'};
const paletteColors=[
 ['Cores do tema', [['Preto','#000000'],['Branco','#ffffff'],['Cinza escuro','#404040'],['Cinza','#808080'],['Cinza claro','#d9d9d9'],['Azul escuro','#17365d'],['Azul','#4472c4'],['Azul claro','#5b9bd5'],['Verde escuro','#548235'],['Laranja','#ed7d31']]],
 ['Cores padrão', [['Vermelho escuro','#c00000'],['Vermelho','#ff0000'],['Laranja claro','#ffc000'],['Amarelo','#ffff00'],['Verde claro','#92d050'],['Verde','#00b050'],['Ciano','#00b0f0'],['Azul intenso','#0070c0'],['Azul marinho','#002060'],['Roxo','#7030a0']]]
];
function updateColorButton(kind){
 $(kind+'-color-indicator').style.backgroundColor=editorColors[kind];
 $(kind+'-color-apply').title='Aplicar '+(kind==='text'?'cor do texto':'marca-texto')+' '+editorColors[kind];
 $(kind+'-color-apply').setAttribute('aria-label','Aplicar cor '+editorColors[kind]);
 const palette=$(kind+'-color-palette');
 for(const button of palette.querySelectorAll('[data-palette-color]'))button.setAttribute('aria-pressed',String(button.dataset.paletteColor===editorColors[kind]));
}
function closeColorPalettes(except=null){
 for(const kind of ['text','highlight']){
  if(kind===except)continue;
  $(kind+'-color-palette').classList.add('hidden');
  $(kind+'-color-toggle').setAttribute('aria-expanded','false');
 }
}
function chooseEditorColor(kind,color){
 if(!/^#[0-9a-f]{6}$/i.test(color))return;
 editorColors[kind]=color.toLowerCase();updateColorButton(kind);
 cmd(kind==='text'?'foreColor':'hiliteColor',editorColors[kind]);
 closeColorPalettes();
}
function openColorPalette(kind){
 const palette=$(kind+'-color-palette'),isOpening=palette.classList.contains('hidden');
 closeColorPalettes();
 if(!isOpening)return;
 const rect=$(kind+'-color-toggle').getBoundingClientRect();
 // Popover is portaled to <body>, otherwise editor-main's overflow:auto clips it.
 palette.classList.remove('hidden');
 const w=palette.getBoundingClientRect().width,h=palette.getBoundingClientRect().height;
 palette.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-w-8))+'px';
 palette.style.top=(rect.bottom+h+8<=window.innerHeight?rect.bottom+5:Math.max(8,rect.top-h-5))+'px';
 $(kind+'-color-toggle').setAttribute('aria-expanded','true');
}
function setupColorPalettes(){
 for(const kind of ['text','highlight']){
  const palette=$(kind+'-color-palette');document.body.append(palette);
  for(const [groupName,swatches] of paletteColors){
   const group=document.createElement('div');group.className='color-palette-group';
   const title=document.createElement('div');title.className='color-palette-title';title.textContent=groupName;group.append(title);
   const grid=document.createElement('div');grid.className='color-palette-grid';
   for(const [name,color] of swatches){
    const b=document.createElement('button');b.type='button';b.className='color-swatch';
    b.dataset.paletteColor=color;b.style.backgroundColor=color;
    b.title=name+' ('+color+')';b.setAttribute('aria-label',name+' '+color);
    // Do not move editor selection when clicking a palette swatch.
    b.addEventListener('mousedown',e=>e.preventDefault());
    b.addEventListener('click',()=>chooseEditorColor(kind,color));grid.append(b);
   }
   group.append(grid);palette.append(group);
  }
  const more=document.createElement('label');more.className='color-palette-custom';
  const caption=document.createElement('span');caption.textContent='Outra cor';
  const picker=document.createElement('input');picker.type='color';picker.value=editorColors[kind];
  picker.id=kind+'-color';picker.setAttribute('aria-label','Escolher cor personalizada');
  picker.addEventListener('change',e=>chooseEditorColor(kind,e.target.value));
  more.append(caption,picker);palette.append(more);
  $(kind+'-color-apply').addEventListener('click',()=>cmd(kind==='text'?'foreColor':'hiliteColor',editorColors[kind]));
  $(kind+'-color-toggle').addEventListener('click',()=>openColorPalette(kind));
  updateColorButton(kind);
 }
 document.addEventListener('pointerdown',e=>{
  if(!e.target.closest?.('.editor-color-control, .editor-color-palette'))closeColorPalettes();
 });
 window.addEventListener('resize',()=>closeColorPalettes());
 document.querySelector('.editor-main').addEventListener('scroll',()=>closeColorPalettes(),{passive:true});
}
function wrapImageWithHandle(src){const esc=src.replace(/"/g,'&quot;');return `<span class="media-frame" style="width:60%;" contenteditable="false"><img alt="Imagem inserida" src="${esc}" style="display:block;width:100%;height:auto;"><span class="media-handle" contenteditable="false"></span></span><p><br></p>`}
function enableMediaResize(){
 el.editor.addEventListener('pointerdown',e=>{
 const handle=e.target.closest?.('.media-handle');if(!handle)return;const frame=handle.closest('.media-frame');if(!frame)return;
 e.preventDefault();e.stopPropagation();const start=e.clientX,initial=frame.getBoundingClientRect().width;
 const max=el.editor.clientWidth-38;frame.classList.add('selected');
 handle.setPointerCapture(e.pointerId);
 function move(ev){const w=clamp(initial+ev.clientX-start,48,max);frame.style.width=Math.round(w)+'px';frame.style.height='auto'}
 function up(){handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',up);frame.classList.remove('selected')}
 handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',up);
 });
}
function makeIconCanvas(){const c=document.createElement('canvas');c.width=112;c.height=112;const x=c.getContext('2d');x.fillStyle='#fff5d4';x.strokeStyle='#9c720f';x.lineWidth=6;x.beginPath();x.roundRect(6,6,100,100,22);x.fill();x.stroke();x.fillStyle='#ce9820';x.beginPath();x.roundRect(23,25,67,53,11);x.fill();x.fillStyle='#fff6d8';x.beginPath();x.roundRect(28,30,57,42,8);x.fill();x.fillStyle='#bd8915';x.beginPath();x.moveTo(40,68);x.lineTo(34,85);x.lineTo(56,72);x.fill();x.fillStyle='#8d6412';x.font='bold 42px Arial';x.fillText('≡',42,65);return c.toDataURL('image/png')}
function renderNoteImage(note,maxHeight=1200){
 const shell=document.createElement('div');shell.className='pdf-export-note';shell.style.cssText=`position:fixed;left:0;top:0;pointer-events:none;z-index:-10;box-sizing:border-box;overflow:hidden;width:${note.width}px;height:auto;background:${note.bg};border:2px solid ${note.border};border-radius:8px;color:#000;font-family:Arial,sans-serif;`;
 const head=document.createElement('div');head.style.cssText='box-sizing:border-box;font-size:15px;font-weight:700;padding:12px 14px;border-bottom:1px solid #b6bdc880;white-space:normal;overflow-wrap:anywhere;';head.textContent=note.title;
 const content=document.createElement('div');content.className='popup-body';content.style.cssText='box-sizing:border-box;padding:13px;font-size:14px;overflow:visible;height:auto;background:transparent;';content.innerHTML=safeHTML(note.html);applyNoteSpacing(content,note.lineSpacing,note.paragraphSpacing);
 shell.append(head,content);document.body.append(shell);
 const natural=Math.ceil(head.offsetHeight+content.scrollHeight+4),height=Math.min(Math.max(90,natural),maxHeight);
 shell.style.height=height+'px';content.style.height=Math.max(0,height-head.offsetHeight-4)+'px';content.style.overflow='hidden';
 return {shell,width:note.width,height};
}

function setWidgetAppearance(doc,button,png,width,height){
 const {PDFName}=window.PDFLib;
 const stream=doc.context.flateStream(`q\n${width.toFixed(3)} 0 0 ${height.toFixed(3)} 0 0 cm\n/Img Do\nQ\n`,{
  Type:PDFName.of('XObject'),Subtype:PDFName.of('Form'),FormType:1,BBox:[0,0,width,height],
  Resources:{XObject:{Img:png.ref}}
 });
 const ref=doc.context.register(stream);
 for(const widget of button.acroField.getWidgets())widget.setNormalAppearance(ref);
}
function addAction(doc,widget,key,src){
 if(!src)return;
 const {PDFName,PDFString}=window.PDFLib;
 const old=widget.dict.lookup(PDFName.of('AA'));
 const actions=old && typeof old.set==='function'?old:doc.context.obj({});
 actions.set(PDFName.of(key),doc.context.obj({S:PDFName.of('JavaScript'),JS:PDFString.of(src)}));
 widget.dict.set(PDFName.of('AA'),actions);
}
function inventoryNonWidgetAnnotations(document) {
 const {PDFName}=window.PDFLib, key=PDFName.of('Subtype');
 return document.getPages().map(page=>{
   const tally={};const items=page.node.Annots();
   for(let i=0;i<(items?.size()||0);i++){
     const item=document.context.lookup(items.get(i));
     const kind=item?.get?.(key)?.toString?.()||'/Unknown';
     if(kind!=='/Widget')tally[kind]=(tally[kind]||0)+1;
   }
   return Object.fromEntries(Object.entries(tally).sort(([a],[b])=>a.localeCompare(b)));
 });
}
function hexRgb(hex){const v=hex.replace('#','');return [0,2,4].map(i=>parseInt(v.slice(i,i+2),16)/255)}
async function exportPDF(delivery='download'){
 if(!state.pdf||state.locked)return;
 busy(true,'Iniciando exportação. Documentos extensos podem demandar memória e processamento…');
 try {
  verifyLib();const {PDFDocument,PDFName,PDFString}=window.PDFLib;
  const doc=await PDFDocument.load(state.bytes,{updateMetadata:false,ignoreEncryption:false});
  if(doc.catalog.get(PDFName.of('Perms')))throw new Error('PDF assinado ou com permissões especiais: exportação bloqueada para evitar invalidar a assinatura.');
  const originalInventory=inventoryNonWidgetAnnotations(doc);
  const pages=doc.getPages();let originalAnnotations=0;
  for(const p of pages)originalAnnotations+=(p.node.Annots()?.size()||0);
  const form=doc.getForm();if(form.getFields().some(field=>field.constructor?.name==='PDFSignature'))throw new Error('PDF com campo de assinatura: exportação bloqueada por segurança.');let removedWidgets=0;
  // Remove only prior widgets created by this specific editor, then regenerate from metadata.
  const oldFields=form.getFields().filter(field=>field.getName().startsWith('NPS_'));
  for(const field of oldFields){removedWidgets+=field.acroField?.getWidgets?.().length||0;form.removeField(field)}
  const iconPng=await doc.embedPng(makeIconCanvas());
  // Render translucent marks OVER the existing page using Multiply: backgrounds
  // cannot hide them, while dark original text remains legible and selectable.
  await burnSolidMarks(doc,pages,state.marks);
  burnMarksOverPageContent(doc,pages,state.marks);
  let done=0;
  for(const n of state.notes){
   status(`Preparando nota ${++done} de ${state.notes.length}…`);
   const page=pages[n.page-1];const sz=page.getSize(),W=sz.width,H=sz.height;
   const exportBox=renderNoteImage(n,H-12),container=exportBox.shell;
   let img;
   try{await Promise.all([...container.querySelectorAll('img')].map(img=>img.decode?.().catch(()=>{})||Promise.resolve()));
      const capture=await window.html2canvas(container,{scale:1.8,useCORS:false,backgroundColor:null,logging:false,allowTaint:false});img=await doc.embedPng(capture.toDataURL('image/png'));
   }finally{container.remove()}
   // Coordinates are normalized in the unrotated page viewport. Rotation is checked explicitly.
   if(page.getRotation()?.angle%360!==0)throw new Error('A página '+n.page+' está rotacionada. Esta versão só exporta novas notas em páginas com rotação 0°.');
   const tx=clamp(n.x*W,15,W-15);const ty=clamp(H-n.y*H,15,H-15);const iconSize=23;
   const popupW=Math.min(exportBox.width,W-12),popupH=Math.min(exportBox.height,H-12);
   const spot=popupCoordinates(tx,H-ty,W,H,popupW,popupH);
   const base='NPS_'+n.id;
   const icon=form.createButton(base+'_icon');
   icon.addToPage('',page,{x:tx-iconSize/2,y:ty-iconSize/2,width:iconSize,height:iconSize,borderWidth:0});
   icon.setImage(iconPng);
   const popup=form.createButton(base+'_popup');
   popup.addToPage('',page,{x:spot.x,y:spot.y,width:popupW,height:popupH,borderWidth:0});
   popup.setImage(img);
   for(const w of popup.acroField.getWidgets())w.dict.set(PDFName.of('F'),doc.context.obj(2)); // Hidden annotation flag
   const st=form.createTextField(base+'_state');st.setText('0');
   const a=makeActions(n.id,n.hover,n.click);
   const iconWidget=icon.acroField.getWidgets()[0];
   addAction(doc,iconWidget,'E',a.enter);addAction(doc,iconWidget,'X',a.exit);addAction(doc,iconWidget,'D',a.down);
   // Click on an open pop-up to close it; supported by PDF viewers that implement Acrobat JavaScript.
   for(const w of popup.acroField.getWidgets())addAction(doc,w,'D',`var p=this.getField(${JSON.stringify(base+'_popup')}),s=this.getField(${JSON.stringify(base+'_state')});if(p&&s){s.value="0";p.display=display.hidden;}`);
  }
  const metadata={version:2,application:'NotaPDF Studio',notes:state.notes};
  doc.catalog.set(PDFName.of('NPSData'),PDFString.of(utf8ToBase64(JSON.stringify(metadata))));
  status('Gravando PDF e validando anotações…');
  const bytes=await doc.save({updateFieldAppearances:false,useObjectStreams:false});
  const result=await PDFDocument.load(bytes,{updateMetadata:false});
  const after=result.getPages().reduce((sum,p)=>sum+(p.node.Annots()?.size()||0),0);
  if(JSON.stringify(inventoryNonWidgetAnnotations(result))!==JSON.stringify(originalInventory))
   throw new Error('Validação falhou: houve alteração na quantidade ou nos tipos das anotações originais de uma página. Download cancelado.');
  const expected=originalAnnotations-removedWidgets+(state.notes.length*2);
  if(after<expected)throw new Error(`Validação falhou: havia ${originalAnnotations} anotações, ${removedWidgets} widgets anteriores foram substituídos, esperadas pelo menos ${expected} anotações finais, mas encontramos ${after}.`);
  const check=result.catalog.lookup(PDFName.of('NPSData'));
  if(!check||JSON.parse(base64ToUtf8(check.decodeText())).notes.length!==state.notes.length)throw new Error('Os metadados editáveis não foram encontrados na validação.');
  if(delivery==='download'){
   if(!githubLibrary?.hasActive())savedSnapshot=editorSnapshot();
   const blob=new Blob([bytes],{type:'application/pdf'});const url=URL.createObjectURL(blob);
   const a=document.createElement('a');a.href=url;a.download=printableName(state.fileName);document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
   status(`PDF exportado: ${state.notes.length} notas interativas · ${after} anotações no total.`);
   showToast(`Arquivo baixado. ${after} anotações verificadas; os dados das ${state.notes.length} notas podem ser reeditados aqui.`,7000);
  }else{
   status(`PDF validado: ${state.notes.length} notas interativas · ${after} anotações. Preparado para enviar ao GitHub.`);
  }
  return {bytes,annotations:after, snapshot:editorSnapshot()};
 }catch(err){console.error(err);showToast('Exportação não concluída: '+err.message,9000);status('Falha na exportação: '+err.message);if(delivery==='github')throw err;return null}finally{busy(false)}
}
function pushHistory(){
 const snap=JSON.stringify({notes:state.notes,marks:state.marks});
 if(state.history[state.historyIndex]===snap)return;
 state.history=state.history.slice(0,state.historyIndex+1);state.history.push(snap);if(state.history.length>80)state.history.shift();state.historyIndex=state.history.length-1;updateHistoryButtons();
}
function restoreHistory(){const snap=JSON.parse(state.history[state.historyIndex]||'{}');state.notes=snap.notes||[];state.marks=snap.marks||[];updateHistoryButtons();renderPage();}
function undo(){if(state.historyIndex>0){state.historyIndex--;restoreHistory();showToast('Ação desfeita.',1200)}}
function redo(){if(state.historyIndex<state.history.length-1){state.historyIndex++;restoreHistory();showToast('Ação refeita.',1200)}}
function updateHistoryButtons(){$('btn-undo').disabled=state.historyIndex<=0;$('btn-redo').disabled=state.historyIndex<0||state.historyIndex>=state.history.length-1;}
function applyFontSize(px){el.editor.focus();restoreSelection();const sel=window.getSelection();if(!sel||!sel.rangeCount)return;const range=sel.getRangeAt(0);if(range.collapsed){const before=new Set(el.editor.querySelectorAll('font'));document.execCommand('fontSize',false,'7');for(const f of el.editor.querySelectorAll('font'))if(!before.has(f)){f.removeAttribute('size');f.style.fontSize=px;}}else{const span=document.createElement('span');span.style.fontSize=px;try{range.surroundContents(span)}catch{const frag=range.extractContents();span.append(frag);range.insertNode(span)}}savedRange=selectionSave();}
function wrapLooseImages(){for(const img of [...el.editor.querySelectorAll('img:not(.media-frame img)')]){if(!img.src.startsWith('data:image/'))continue;const frame=document.createElement('span');frame.className='media-frame';frame.contentEditable='false';frame.style.width=Math.min(100,Math.round((img.width||240)/Math.max(1,el.editor.clientWidth)*100))+'%';img.replaceWith(frame);img.style.cssText='display:block;width:100%;height:auto';frame.append(img);const h=document.createElement('span');h.className='media-handle';h.contentEditable='false';frame.append(h)}}
async function buildTextLayer(page,view,seq){
 const lib=pdfjs||window.__pdfjs||await loadPDFJs();
 el.textLayer.replaceChildren();
 el.textLayer.style.width=view.width+'px';el.textLayer.style.height=view.height+'px';
 el.textLayer.style.setProperty('--scale-factor',String(view.scale));
 el.textLayer.style.setProperty('--total-scale-factor',String(view.scale));
 el.pageContainer.classList.toggle('text-select-mode',state.selectionMode);
 el.textLayer.style.pointerEvents=state.selectionMode?'auto':'none';
 try{
  // PDF.js 4.x exposes TextLayer (the old renderTextLayer function is not
  // exported from the generic build in this pinned release).
  const textContentSource=typeof page.streamTextContent==='function'
   ?page.streamTextContent({includeMarkedContent:true,disableNormalization:true})
   :await page.getTextContent();
  if(seq!==renderSequence)return;
  if(typeof lib.TextLayer==='function'){
   const layer=new lib.TextLayer({textContentSource,container:el.textLayer,viewport:view});
   state.textLayerTask=layer;
   await layer.render();
  }else if(typeof lib.renderTextLayer==='function'){
   const content=typeof page.streamTextContent==='function'?await page.getTextContent():textContentSource;
   const task=lib.renderTextLayer({textContentSource:content,container:el.textLayer,viewport:view,textDivs:[]});
   state.textLayerTask=task;await task.promise;
  }else{
   throw new Error('A versão carregada do PDF.js não oferece TextLayer. Atualize a biblioteca PDF.js.');
  }
  if(seq!==renderSequence)return;
  // The TextLayer's invisible text is solely for interaction. Wait for its
  // embedded PDF fonts before any Range geometry is measured.
  await document.fonts.ready;
  if(seq!==renderSequence)return;
  await mapPdfTextItemGeometry(page,seq);
  if(seq!==renderSequence)return;
  el.textLayer.classList.toggle('text-layer-disabled',!state.selectionMode);
  if(!el.textLayer.querySelector('span'))console.warn('PDF.js não encontrou texto selecionável nesta página; o PDF pode ser digitalizado como imagem.');
 }catch(e){
  if(e?.name==='AbortException')return;
  console.error('Falha ao criar camada de texto selecionável:',e);
  showToast('Não foi possível preparar a seleção de texto nesta página: '+e.message,6500);
 }
}
// Associate PDF.js TextLayer spans with TextContent items. Each item has the
// actual start position and total width from PDF text operators, independent
// of browser font substitution. Unmatched spans keep their DOM fallback.
async function mapPdfTextItemGeometry(page,seq){
 if(typeof page.getTextContent!=='function')return;
 try{
  const source=await page.getTextContent({includeMarkedContent:true,disableNormalization:true});
  if(seq!==renderSequence)return;
  const items=(source.items||[]).filter(item=>typeof item.str==='string'&&item.str.length&&Array.isArray(item.transform));
  const spans=[...el.textLayer.querySelectorAll('span')].filter(span=>span.firstChild?.nodeType===Node.TEXT_NODE&&span.textContent);
  // The display list retains real advances for PDF glyphs, including TJ,
  // character spacing and justified word spacing.  Its font metrics are more
  // accurate than measuring a substituted browser font with DOM Range.
  let glyphs=pdfGlyphCache.get(state.page);
  if(!glyphs){
   glyphs=[];
   if(typeof page.getOperatorList==='function' && pdfjs?.OPS){
    try {
     const operators=await page.getOperatorList();
     if(seq!==renderSequence)return;
     if(operators.fnArray.length<125000)glyphs=pdfGlyphAdvances(operators,pdfjs.OPS);
    }catch(error){console.warn('Métricas detalhadas não disponíveis; geometria por item preservada.',error)}
   }
   if(pdfGlyphCache.size>=5)pdfGlyphCache.delete(pdfGlyphCache.keys().next().value);
   pdfGlyphCache.set(state.page,glyphs);
  }
  let glyphCursor=0, itemIndex=0;
  const sameText=(a,b)=>a===b||a.normalize('NFC')===b.normalize('NFC');
  for(const span of spans){
   const value=span.textContent;
   // PDF.js may add an extra DOM span or skip a whitespace-only text item.
   // Do not associate a mismatched item with the wrong text.
   let found=-1;
   for(let next=itemIndex;next<Math.min(itemIndex+8,items.length);next++){
    if(sameText(items[next].str,value)){found=next;break;}
   }
   if(found<0)continue;
   const item=items[found];itemIndex=found+1;
   if(!Number.isFinite(item.width)||item.width<=0)continue;
   const transform=item.transform;
   if(transform.length<6||!transform.every(Number.isFinite)||Math.abs(transform[1])>.01||Math.abs(transform[2])>.01)continue;
   const matched=matchPdfGlyphGeometry(value,glyphs,glyphCursor,transform[4],item.width,transform[5]);
   if(matched)glyphCursor=matched.next;
   pdfTextGeometry.set(span,{x:transform[4],width:item.width,text:value,
    starts:matched?.starts||null,ends:matched?.ends||null});
  }
 }catch(err){console.warn('Geometria PDF não disponível para esta página; usando a seleção do navegador.',err)}
}
function createTextRange(start,end,map){
 const a=textIndexToDomPoint(start,map),b=textIndexToDomPoint(end,map);
 if(!a||!b)return null;
 const range=document.createRange();
 try{range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);return range}catch{return null}
}
function rectSnapshot(rect){
 return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height};
}
// Client rectangles anchored to PDF.js's actual TextContent item widths.
// Text rendering remains on the original canvas; browser font metrics are only
// used for relative offsets inside a text item, never its page origin or width.
function pdfAnchoredClientRects(range){
 if(!range)return[];
 const view=state.currentViewport,pageBox=el.pageContainer.getBoundingClientRect();
 if(!view)return [...range.getClientRects()].map(rectSnapshot);
 const rects=[];
 for(const span of el.textLayer.querySelectorAll('span')){
  const node=span.firstChild;
  if(!node||node.nodeType!==Node.TEXT_NODE||!node.length||!range.intersectsNode(node))continue;
  const start=node===range.startContainer?range.startOffset:0;
  const end=node===range.endContainer?range.endOffset:node.length;
  if(end<=start)continue;
  const part=document.createRange();part.setStart(node,start);part.setEnd(node,end);
  const item=pdfTextGeometry.get(span);
  const whole=document.createRange();whole.selectNodeContents(node);
  const original=whole.getBoundingClientRect();
  for(const raw of part.getClientRects()){
   if(raw.width<=.1||raw.height<=.1)continue;
   const rect=rectSnapshot(raw);
   if(item && (item.starts || original.width>.1)){
    // The PDF glyph map is authoritative.  Browser Range widths are used
    // only when the PDF operator list cannot be matched safely.
    const f1=item.starts ? item.starts[start] : clamp((rect.left-original.left)/original.width,0,1);
    const f2=item.ends ? item.ends[end-1] : clamp((rect.right-original.left)/original.width,0,1);
    rect.left=pageBox.left+view.convertToViewportPoint(item.x+item.width*f1,0)[0];
    rect.right=pageBox.left+view.convertToViewportPoint(item.x+item.width*f2,0)[0];
    rect.width=rect.right-rect.left;
   }
   if(rect.width>.1)rects.push(rect);
  }
 }
 return rects.length?rects:[...range.getClientRects()].map(rectSnapshot);
}
function updatePdfSelectionOverlay(){
 el.selectionLayer.replaceChildren();
 if(!state.selectionMode||!state.pdf)return;
 const selection=window.getSelection();
 if(!selection?.rangeCount||selection.isCollapsed||!el.textLayer.contains(selection.anchorNode)||!el.textLayer.contains(selection.focusNode))return;
 const page=el.pageContainer.getBoundingClientRect();
 for(const r of pdfAnchoredClientRects(selection.getRangeAt(0))){
  if(r.width<=.4||r.height<=.4)continue;
  const band=document.createElement('div');band.className='pdf-selection-band';
  band.style.cssText=`left:${r.left-page.left}px;top:${r.top-page.top}px;width:${r.width}px;height:${r.height}px`;
  el.selectionLayer.append(band);
 }
}
function buildPdfTextIndex(){
 const walker=document.createTreeWalker(el.textLayer,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
 const entries=[];let text='',node,previousSpan=null,previousRect=null;
 while((node=walker.nextNode())){
  if(node.nodeType===Node.ELEMENT_NODE){
   if(node.tagName==='BR'){
    if(text&&!text.endsWith('\n'))text+='\n';
    previousSpan=null;previousRect=null;
   }
   continue;
  }
  const value=node.nodeValue||'';if(!value.length)continue;
  const span=node.parentElement?.closest('span')||node.parentElement;
  const browserRect=span?.getBoundingClientRect?.();
  const item=span&&pdfTextGeometry.get(span);
  const pageBounds=el.pageContainer.getBoundingClientRect();
  const rect=browserRect&&item&&state.currentViewport?{
   ...rectSnapshot(browserRect),
   left:pageBounds.left+state.currentViewport.convertToViewportPoint(item.x,0)[0],
   right:pageBounds.left+state.currentViewport.convertToViewportPoint(item.x+item.width,0)[0]
  }:browserRect;
  if(previousSpan&&span!==previousSpan&&rect&&previousRect&&
     !/\s$/u.test(text)&&!/^\s/u.test(value)){
   const minHeight=Math.max(1,Math.min(previousRect.height||1,rect.height||1));
   // Compare baselines, not just top edges: different font sizes on the same
   // line should remain one visual line.
   const sameLine=Math.abs(rect.bottom-previousRect.bottom)<=Math.max(2.5,minHeight*.30);
   if(!sameLine)text+='\n';
   else{
    const gap=rect.left-previousRect.right;
    const fontSize=parseFloat(getComputedStyle(span).fontSize)||minHeight;
    if(gap>Math.max(1.25,fontSize*.13))text+=' ';
   }
  }
  const start=text.length;text+=value;entries.push({node,start,end:text.length});
  if(span&&rect&&rect.width>0&&rect.height>0){previousSpan=span;previousRect=rectSnapshot(rect)}
 }
 const words=[];
 if(typeof Intl.Segmenter==='function'){
  const segmenter=new Intl.Segmenter('pt-BR',{granularity:'word'});
  for(const part of segmenter.segment(text)){
   if(!part.isWordLike)continue;
   const word={start:part.index,end:part.index+part.segment.length,index:words.length,rects:[]};
   const range=createTextRange(word.start,word.end,{text,entries});
   if(range)word.rects=pdfAnchoredClientRects(range).filter(r=>r.width>.2&&r.height>.2);
   if(word.rects.length)words.push(word);
  }
 }else{
  const re=/[\p{L}\p{N}_]+/gu;let match;
  while((match=re.exec(text))){
   const word={start:match.index,end:match.index+match[0].length,index:words.length,rects:[]};
   const range=createTextRange(word.start,word.end,{text,entries});
   if(range)word.rects=pdfAnchoredClientRects(range).filter(r=>r.width>.2&&r.height>.2);
   if(word.rects.length)words.push(word);
  }
 }
 words.forEach((word,index)=>word.index=index);
 return {text,entries,words};
}
function domPointToTextIndex(node,offset,map){
 const entry=map.entries.find(item=>item.node===node);
 return entry?entry.start+clamp(offset,0,entry.end-entry.start):null;
}
function textIndexToDomPoint(index,map){
 index=clamp(index,0,map.text.length);
 for(const entry of map.entries){
  if(index>=entry.start&&index<=entry.end)return {node:entry.node,offset:index-entry.start};
  if(index<entry.start)return {node:entry.node,offset:0};
 }
 const last=map.entries.at(-1);return last?{node:last.node,offset:last.end-last.start}:null;
}
function wordForCaret(index,map,direction=1){
 const words=map.words;
 for(let i=0;i<words.length;i++){
  const w=words[i];
  if(index>=w.start&&index<w.end)return {...w,index:i,inside:true,side:'inside'};
  if(index===w.end)return {...w,index:i,inside:false,side:'after'};
  if(index<w.start)return direction>=0?{...w,index:i,inside:false,side:'before'}:i?{...words[i-1],index:i-1,inside:false,side:'after'}:{...w,index:i,inside:false,side:'before'};
 }
 const last=words.at(-1);return last?{...last,index:words.length-1,inside:false,side:'after'}:null;
}
function caretAtPoint(x,y){
 let range=null;
 if(document.caretRangeFromPoint)range=document.caretRangeFromPoint(x,y);
 if(range&&el.textLayer.contains(range.startContainer))return {node:range.startContainer,offset:range.startOffset};
 if(document.caretPositionFromPoint){
  const pos=document.caretPositionFromPoint(x,y);
  if(pos&&el.textLayer.contains(pos.offsetNode))return {node:pos.offsetNode,offset:pos.offset};
 }
 return null;
}
function verticalGap(y,rect){return y<rect.top?rect.top-y:y>rect.bottom?y-rect.bottom:0}
function horizontalGap(x,rect){return x<rect.left?rect.left-x:x>rect.right?x-rect.right:0}
function nearestWordAtPoint(x,y,map){
 let best=null;
 for(const word of map.words)for(const rect of word.rects){
  const dy=verticalGap(y,rect),dx=horizontalGap(x,rect);
  // Strongly prioritize the visual line. A long horizontal drag on a title
  // must not jump to the first word on the next line until y reaches that line.
  const score=dy*10000+dx;
  if(!best||score<best.score)best={word,rect,score,dy,dx};
 }
 return best;
}
function graphemeParts(text){
 if(typeof Intl.Segmenter==='function'){
  return [...new Intl.Segmenter('pt-BR',{granularity:'grapheme'}).segment(text)]
   .map(part=>({start:part.index,end:part.index+part.segment.length}));
 }
 const out=[];let offset=0;
 for(const cp of Array.from(text)){out.push({start:offset,end:offset+cp.length});offset+=cp.length}
 return out;
}
function nearestCharacterBoundary(word,wordRect,x,y,map){
 const value=map.text.slice(word.start,word.end),parts=graphemeParts(value);
 let best=null;
 for(const part of parts){
  const range=createTextRange(word.start+part.start,word.start+part.end,map);if(!range)continue;
  for(const raw of pdfAnchoredClientRects(range)){
   if(raw.width<.1||raw.height<.1)continue;
   const rect=rectSnapshot(raw),dy=verticalGap(y,rect),dx=horizontalGap(x,rect),score=dy*10000+dx;
   if(!best||score<best.score)best={part,rect,score};
  }
 }
 if(!best){
  const ratio=clamp((x-wordRect.left)/Math.max(1,wordRect.width),0,1);
  return ratio<.5?word.start:word.end;
 }
 if(x<=best.rect.left)return word.start+best.part.start;
 if(x>=best.rect.right)return word.start+best.part.end;
 return word.start+(x<(best.rect.left+best.rect.right)/2?best.part.start:best.part.end);
}
function pointToPdfPosition(x,y,map){
 const hit=nearestWordAtPoint(x,y,map);
 if(!hit){
  const caret=caretAtPoint(x,y);if(!caret)return null;
  const index=domPointToTextIndex(caret.node,caret.offset,map);
  const word=index===null?null:wordForCaret(index,map,1);
  return word?{index:clamp(index,word.start,word.end),word,side:'inside',rect:word.rects[0]}:null;
 }
 const {word,rect}=hit;
 // Native PDF glyph advances also drive the cursor.  Otherwise a browser
 // caret position can disagree with the colored band on justified text.
 const pdfMapped=map.entries.some(entry=>entry.end>word.start&&entry.start<word.end&&
  pdfTextGeometry.get(entry.node.parentElement?.closest('span'))?.starts);
 if(pdfMapped){
  if(x<rect.left)return {index:word.start,word,rect,side:'before'};
  if(x>rect.right)return {index:word.end,word,rect,side:'after'};
  const index=nearestCharacterBoundary(word,rect,x,y,map);
  return {index,word,rect,side:index<=word.start?'before':index>=word.end?'after':'inside'};
 }
 const caret=caretAtPoint(x,y);
 if(caret){
  const index=domPointToTextIndex(caret.node,caret.offset,map);
  if(index!==null&&index>=word.start&&index<=word.end){
   const caretSpan=caret.node.parentElement?.closest('span');
   const caretRect=caretSpan?.getBoundingClientRect?.();
   if(!caretRect||verticalGap(y,caretRect)<=Math.max(4,rect.height*.55))
    return {index:clamp(index,word.start,word.end),word,rect,side:index<=word.start?'before':index>=word.end?'after':'inside'};
  }
 }
 let side='inside',index;
 if(x<rect.left){side='before';index=word.start}
 else if(x>rect.right){side='after';index=word.end}
 else index=nearestCharacterBoundary(word,rect,x,y,map);
 return {index,word,rect,side};
}
function setPdfSelection(anchorIndex,focusIndex,map){
 const anchor=textIndexToDomPoint(anchorIndex,map),focus=textIndexToDomPoint(focusIndex,map);
 if(!anchor||!focus)return false;
 const selection=window.getSelection();if(!selection)return false;
 selection.removeAllRanges();
 if(typeof selection.setBaseAndExtent==='function')selection.setBaseAndExtent(anchor.node,anchor.offset,focus.node,focus.offset);
 else{
  const range=document.createRange();
  const [start,end]=anchorIndex<=focusIndex?[anchor,focus]:[focus,anchor];
  range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);selection.addRange(range);
 }
 if(selection.rangeCount&&!selection.isCollapsed)savedPdfRange=selection.getRangeAt(0).cloneRange();
 else savedPdfRange=null;
 updatePdfSelectionOverlay();
 return true;
}
function selectPdfWordAtPoint(x,y,map=buildPdfTextIndex()){
 const hit=pointToPdfPosition(x,y,map);if(!hit)return false;
 setPdfSelection(hit.word.start,hit.word.end,map);return true;
}
// Temporary quick actions use the existing C/V/B marking commands. A separate
// gesture tracker watches the mouse at the document capture phase because a
// native PDF.js text selection may occur without beginPdfTextSelection running.
// In particular, never make displaying this menu depend on pdfSelectionDrag.
function hideQuickMarkToolbar(){
 $('quick-mark-toolbar').classList.add('hidden');
}
function setQuickToolbarEnabled(enabled){
 state.quickToolbarEnabled=!!enabled;
 for(const id of ['quick-toolbar-enabled','fs-quick-toolbar-enabled'])$(id).checked=state.quickToolbarEnabled;
 if(!state.quickToolbarEnabled){
  quickMarkGesture=null;
  hideQuickMarkToolbar();
 }
}
function beginQuickMarkGesture(e){
 if(!state.quickToolbarEnabled||e.button!==0||e.pointerType==='touch'||!state.pdf||state.locked||
    !state.selectionMode||state.placing||
    !$('dialog-backdrop').classList.contains('hidden')||
    !el.textLayer.contains(e.target))return;
 quickMarkGesture={id:e.pointerId,startX:e.clientX,startY:e.clientY,
  moved:false,page:state.page,sequence:renderSequence};
 hideQuickMarkToolbar();
}
function trackQuickMarkGesture(e){
 const gesture=quickMarkGesture;
 if(!gesture||gesture.id!==e.pointerId)return;
 if(Math.hypot(e.clientX-gesture.startX,e.clientY-gesture.startY)>4)
  gesture.moved=true;
}
function finishQuickMarkGesture(e){
 if(!state.quickToolbarEnabled){quickMarkGesture=null;return;}
 const gesture=quickMarkGesture;
 if(!gesture||gesture.id!==e.pointerId)return;
 quickMarkGesture=null;
 if(e.type==='pointercancel'||
   !(gesture.moved||Math.hypot(e.clientX-gesture.startX,e.clientY-gesture.startY)>4))return;
 const clientX=e.clientX,clientY=e.clientY;
 const offerToolbar=()=>{
  if(gesture.page!==state.page||gesture.sequence!==renderSequence)return false;
  const selection=window.getSelection();
  if(!selection?.rangeCount||selection.isCollapsed||
     !el.textLayer.contains(selection.anchorNode)||
     !el.textLayer.contains(selection.focusNode))return false;
  savedPdfRange=selection.getRangeAt(0).cloneRange();
  showQuickMarkToolbar(clientX,clientY);
  return !$('quick-mark-toolbar').classList.contains('hidden');
 };
 // The custom selector already commits its Range during pointermove. Show
 // immediately in this case, before a later browser mouseup can clear it.
 // Native selections, in contrast, may only commit on mouseup: retry next frame.
 if(!offerToolbar())requestAnimationFrame(offerToolbar);
}
function showQuickMarkToolbar(clientX,clientY){
 if(!state.quickToolbarEnabled||!state.pdf||state.locked||!state.selectionMode||state.placing||
    !$('dialog-backdrop').classList.contains('hidden')||!selectionRects().length)return;
 const bar=$('quick-mark-toolbar');
 $('quick-mark-primary').style.setProperty('--quick-mark-color',state.markColors.primary);
 $('quick-mark-secondary').style.setProperty('--quick-mark-color',state.markColors.secondary);
 $('quick-mark-underline').style.setProperty('--quick-mark-color',state.markColors.underline);
 bar.classList.remove('hidden');
 const width=bar.offsetWidth,height=bar.offsetHeight,edge=8,gap=9;
 // The centre of the middle button is horizontally over the release point,
 // unless the toolbar must be shifted to remain inside the viewport.
 const left=clamp(clientX-width/2,edge,Math.max(edge,window.innerWidth-width-edge));
 const above=clientY-height-gap;
 const top=above>=edge?above:clamp(clientY+gap,edge,Math.max(edge,window.innerHeight-height-edge));
 bar.style.left=left+'px';bar.style.top=top+'px';
}
function beginPdfTextSelection(e){
 if(e.button===0)hideQuickMarkToolbar();
 if(!state.selectionMode||e.button!==0||e.pointerType==='touch')return;
 const map=buildPdfTextIndex(),hit=pointToPdfPosition(e.clientX,e.clientY,map);if(!hit)return;
 pdfSelectionDrag={map,anchorIndex:hit.index,anchorWord:hit.word,lastIndex:hit.index,lastWordIndex:hit.word.index,lastX:e.clientX,lastY:e.clientY,startX:e.clientX,startY:e.clientY,moved:false,pointerId:e.pointerId};
 setPdfSelection(hit.index,hit.index,map);e.preventDefault();
}
function movePdfTextSelection(e){
 const drag=pdfSelectionDrag;if(!drag||e.pointerId!==drag.pointerId)return;
 const hit=pointToPdfPosition(e.clientX,e.clientY,drag.map);if(!hit)return;
 if(Math.hypot(e.clientX-(drag.startX??e.clientX),e.clientY-(drag.startY??e.clientY))>2||hit.index!==drag.anchorIndex)drag.moved=true;
 const anchorWord=drag.anchorWord,targetWord=hit.word;
 let anchor=drag.anchorIndex,focus=hit.index;
 if(targetWord.index>anchorWord.index){
  anchor=anchorWord.start;
  const reversing=targetWord.index<drag.lastWordIndex||
   (targetWord.index===drag.lastWordIndex&&(hit.index<drag.lastIndex||e.clientX<drag.lastX));
  focus=reversing?hit.index:hit.side==='before'?targetWord.start:targetWord.end;
 }else if(targetWord.index<anchorWord.index){
  anchor=anchorWord.end;
  const reversing=targetWord.index>drag.lastWordIndex||
   (targetWord.index===drag.lastWordIndex&&(hit.index>drag.lastIndex||e.clientX>drag.lastX));
  focus=reversing?hit.index:hit.side==='after'?targetWord.end:targetWord.start;
 }else{
  anchor=drag.anchorIndex;focus=hit.index;
 }
 drag.lastIndex=hit.index;drag.lastWordIndex=targetWord.index;drag.lastX=e.clientX;drag.lastY=e.clientY;
 setPdfSelection(anchor,focus,drag.map);e.preventDefault();
}
function finishPdfTextSelection(e){
 if(!pdfSelectionDrag||e.pointerId!==pdfSelectionDrag.pointerId)return;
 const drag=pdfSelectionDrag;pdfSelectionDrag=null;
 if(drag.moved){
  const selection=window.getSelection();
  if(selection?.rangeCount&&!selection.isCollapsed)savedPdfRange=selection.getRangeAt(0).cloneRange();
  // The independent gesture tracker shows the quick toolbar after the
  // browser has committed its final selection (including native selections).
 }
}
function selectionRects(){
 const sel=window.getSelection();
 let range=null;
 if(sel&&sel.rangeCount&&!sel.isCollapsed&&el.textLayer.contains(sel.anchorNode)&&el.textLayer.contains(sel.focusNode)){
  range=sel.getRangeAt(0).cloneRange();savedPdfRange=range.cloneRange();
 }else if(savedPdfRange&&el.textLayer.contains(savedPdfRange.commonAncestorContainer)){
  range=savedPdfRange.cloneRange();
 }
 if(!range||!state.currentViewport)return[];
 const page=el.pageContainer.getBoundingClientRect(),view=state.currentViewport;
 return pdfAnchoredClientRects(range).filter(r=>r.width>.1&&r.height>.1).map(r=>{
  const a=view.convertToPdfPoint(r.left-page.left,r.bottom-page.top);
  const b=view.convertToPdfPoint(r.right-page.left,r.top-page.top);
  return {x1:Math.min(a[0],b[0]),y1:Math.min(a[1],b[1]),x2:Math.max(a[0],b[0]),y2:Math.max(a[1],b[1])};
 }).filter(r=>r.x2>r.x1&&r.y2>r.y1);
}

function setTextSelectionMode(enabled){
 hideQuickMarkToolbar();
 state.selectionMode=!!enabled;
 el.pageContainer.classList.toggle('text-select-mode',state.selectionMode);
 el.textLayer.style.pointerEvents=state.selectionMode?'auto':'none';
 $('btn-select-text').classList.toggle('active',state.selectionMode);
 $('btn-select-text').setAttribute('aria-pressed',String(state.selectionMode));
 $('btn-select-text').title=state.selectionMode?'Seleção de texto ativa':'Ativar seleção de texto';
 $('fs-select-text').classList.toggle('active',state.selectionMode);
 updatePdfSelectionOverlay();
}
function effectiveMarkOpacity(mark){
 const value=Number(mark.opacity);
 return mark.opacity!=null&&Number.isFinite(value)?clamp(value,.1,1):.42;
}
/* Solid mode is separate from the normal PDF Multiply/opacity path. It creates
 * a small appearance overlay, never a raster replacement of the PDF page.
 * The original page text remains intact underneath (searchable/selectable).
 * Distinguish ink from background using local luminance. This is intended for
 * ordinary dark-on-light PDF text, including colored page backgrounds.
 */
function solidPatch(canvas,viewport,rect,hex){
 if(!/^#[a-f\d]{6}$/i.test(hex))throw new Error('Cor sólida inválida.');
 const p=viewport.convertToViewportPoint(rect.x1,rect.y1-.55),q=viewport.convertToViewportPoint(rect.x2,rect.y2+.55);
 const left=Math.min(p[0],q[0]),top=Math.min(p[1],q[1]),width=Math.abs(p[0]-q[0]),height=Math.abs(p[1]-q[1]);
 if(width<.1||height<.1)throw new Error('A seleção não possui área suficiente para o destaque sólido.');
 const sx=canvas.width/viewport.width,sy=canvas.height/viewport.height;
 const patch=document.createElement('canvas');patch.width=Math.max(1,Math.ceil(width*sx));patch.height=Math.max(1,Math.ceil(height*sy));
 const cx=patch.getContext('2d',{willReadFrequently:true});
 cx.fillStyle='#fff';cx.fillRect(0,0,patch.width,patch.height);
 cx.drawImage(canvas,left*sx,top*sy,width*sx,height*sy,0,0,patch.width,patch.height);
 const img=cx.getImageData(0,0,patch.width,patch.height),data=img.data;
 // Median of sparsely sampled pixels is usually the page background, not ink.
 // Avoid excessive sorting/memory allocations for large selections.
 const lum=[];const step=Math.max(1,Math.floor(Math.sqrt((patch.width*patch.height)/5000)));
 for(let y=0;y<patch.height;y+=step)for(let x=0;x<patch.width;x+=step){
  const i=(y*patch.width+x)*4;
  lum.push(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2]);
 }
 lum.sort((a,b)=>a-b);
 const bg=lum[Math.floor(lum.length*.57)]||255;
 const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
 const targetLum=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
 const darkBackground=bg<95;
 for(let i=0;i<data.length;i+=4){
  const v=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
  // Anti-aliased glyphs are recomposed from original pixels; all other pixels
  // become exactly the selected color at full strength.
  const contrast=darkBackground?(v-bg)/Math.max(48,(255-bg)*.7):(bg-v)/Math.max(50,bg*.7);
  const ink=Math.max(0,Math.min(1,(contrast-.06)/.82));
  const darkColor=targetLum<125;
  for(let k=0;k<3;k++){
   const foreground=darkColor?(darkBackground?data[i+k]:255):data[i+k];
   data[i+k]=Math.round(rgb[k]*(1-ink)+foreground*ink);
  }
  data[i+3]=255;
 }
 cx.putImageData(img,0,0);
 return {canvas:patch,left,top,width,height};
}

async function burnSolidMarks(doc,pages,marks){
 const groups=new Map();
 for(const mark of marks.filter(m=>m.type==='solid')){
  if(!groups.has(mark.page))groups.set(mark.page,[]);
  groups.get(mark.page).push(mark);
 }
 for(const [pageNumber,pageMarks] of groups){
  const source=await state.pdf.getPage(pageNumber),page=pages[pageNumber-1];
  if(!page)throw new Error('Página do destaque sólido não encontrada.');
  const sz=page.getSize(),scale=clamp(Math.sqrt(9_000_000/(sz.width*sz.height)),1.5,3);
  const view=source.getViewport({scale});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
  const context=canvas.getContext('2d',{alpha:false});
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
  status(`Preparando destaque sólido na página ${pageNumber}…`);
  const render=source.render({canvasContext:context,viewport:view,annotationMode:0});await render.promise;
  for(const mark of pageMarks)for(const rect of mark.rects){
   const patch=solidPatch(canvas,view,rect,mark.color);
   const png=await doc.embedPng(patch.canvas.toDataURL('image/png'));
   page.drawImage(png,{x:rect.x1,y:rect.y1-.55,width:rect.x2-rect.x1,height:rect.y2-rect.y1+1.1});
  }
  canvas.width=canvas.height=0;
 }
}

// Single routing point shared by toolbar clicks, fullscreen buttons and
// Alt/Option+C/V. The selected slot supplies its own color in both modes.
// The solid path never reads markOpacity; Alt/Option+B remains an underline.
function applyColorSlot(slot){
 if(slot!=='primary'&&slot!=='secondary')return;
 applyMark(state.solidShortcuts?'solid':'highlight',state.markColors[slot]);
}
function setSolidShortcutMode(enabled){
 state.solidShortcuts=!!enabled;
 for(const id of ['solid-shortcuts','fs-solid-shortcuts'])$(id).checked=state.solidShortcuts;
 const mode=state.solidShortcuts?'Destaque sólido (100%, sem opacidade)':'Grifo comum (usa opacidade)';
 for(const [id,shortcut] of [['mark-blue','C'],['mark-yellow','V'],['fs-mark-primary','C'],['fs-mark-secondary','V']]){
  $(id).title=`${mode} · Alt/Option+${shortcut}`;
 }
}
function applyMark(type,color){
 hideQuickMarkToolbar();
 if(!state.pdf||state.locked)return;
 const rects=selectionRects();
 if(!rects.length){showToast('Selecione primeiro um trecho de texto no PDF.');return;}
 state.marks.push({id:newId(),page:state.page,type,color,opacity:type==='highlight'?state.markOpacity:1,rects});
 pushHistory();window.getSelection()?.removeAllRanges();savedPdfRange=null;updatePdfSelectionOverlay();drawBurnedMarks(state.currentViewport);
 showToast(type==='solid'?'Destaque sólido aplicado, independente da opacidade. Salve o PDF para incorporar.':type==='highlight'?`Grifo aplicado com ${Math.round(state.markOpacity*100)}% de opacidade. Salve o PDF para incorporar.`:'Sublinhado aplicado. Salve o PDF para incorporar.');
}
function drawBurnedMarks(view){
 el.marksLayer.replaceChildren();
 for(const m of state.marks.filter(x=>x.page===state.page))for(const r of m.rects){
  const a=view.convertToViewportPoint(r.x1,r.y1),b=view.convertToViewportPoint(r.x2,r.y2);
  if(m.type==='solid'){
   // Repaint just the selected area with the exact palette color and the original ink.
   const patch=solidPatch(el.canvas,view,r,m.color),node=patch.canvas;
   node.className='burned-mark solid';
   node.style.left=patch.left+'px';node.style.top=patch.top+'px';
   node.style.width=patch.width+'px';node.style.height=patch.height+'px';
   el.marksLayer.append(node);continue;
  }
  const node=document.createElement('div');node.className='burned-mark '+m.type;
  const left=Math.min(a[0],b[0]),top=Math.min(a[1],b[1]),width=Math.abs(b[0]-a[0]),height=Math.abs(b[1]-a[1]);
  node.style.left=left+'px';node.style.width=width+'px';node.style.setProperty('--mark-color',m.color);node.style.setProperty('--mark-opacity',String(effectiveMarkOpacity(m)));
  if(m.type==='underline'){
   node.style.top=(Math.max(a[1],b[1])+.55)+'px';node.style.height='1.15px';
  }else{
   node.style.top=top+'px';node.style.height=height+'px';
  }
  el.marksLayer.append(node);
 }
}
function pdfNumber(value){return Number(Number(value).toFixed(3)).toString();}
function burnMarksOverPageContent(doc,pages,marks){
 const byPage=new Map();for(const mark of marks){if(!byPage.has(mark.page))byPage.set(mark.page,[]);byPage.get(mark.page).push(mark);}
 for(const [pageNumber,pageMarks] of byPage){
  const page=pages[pageNumber-1];if(!page)throw new Error('Uma marcação aponta para uma página inexistente.');
  page.node.normalize();
  const states=new Map();
  function markState(alpha){
   const key=String(alpha);
   if(states.has(key))return states.get(key);
   const entry=doc.context.obj({Type:'ExtGState',ca:alpha,CA:1,BM:'Multiply'});
   const reference=doc.context.register(entry);
   const name=page.node.newExtGState('NPSMark'+states.size,reference).toString()+' gs';
   states.set(key,name);return name;
  }
  const ops=['q'];
  for(const mark of pageMarks){
   if(mark.type==='solid')continue;
   if(!/^#[0-9a-f]{6}$/i.test(mark.color||''))continue;
   const color=hexRgb(mark.color).map(pdfNumber).join(' ');
   if(mark.type==='highlight'){
    ops.push(markState(effectiveMarkOpacity(mark)),color+' rg');
    for(const r of mark.rects){
     const x=pdfNumber(r.x1),y=pdfNumber(r.y1-.55),w=pdfNumber(Math.max(0,r.x2-r.x1)),h=pdfNumber(Math.max(0,r.y2-r.y1+1.1));
     if(Number(w)>0&&Number(h)>0)ops.push(`${x} ${y} ${w} ${h} re f`);
    }
   }else if(mark.type==='underline'){
    ops.push(markState(1),color+' RG','0.72 w','0 J');
    for(const r of mark.rects){
     const x1=pdfNumber(r.x1),x2=pdfNumber(r.x2),y=pdfNumber(r.y1-.85);
     if(Number(x2)>Number(x1))ops.push(`${x1} ${y} m ${x2} ${y} l S`);
    }
   }
  }
  ops.push('Q');
  const stream=doc.context.stream(ops.join('\n')+'\n');
  const streamRef=doc.context.register(stream);
  const contents=page.node.Contents();
  if(!contents||typeof contents.insert!=='function'||typeof contents.push!=='function')throw new Error('Não foi possível inserir a marcação no conteúdo original desta página.');
  // Preserve original content stream semantics; overlay is after opaque backgrounds.
  const before=doc.context.register(doc.context.stream('q\n'));
  const after=doc.context.register(doc.context.stream('Q\n'));
  contents.insert(0,before);contents.push(after);contents.push(streamRef);
 }
}
function syncFullscreenState(){
 hideQuickMarkToolbar();
 const active=!!document.fullscreenElement||document.body.classList.contains('fullscreen-fallback');
 document.body.classList.toggle('fullscreen-mode',active);
 $('btn-fullscreen').textContent=active?'⤢':'⛶';
 $('btn-fullscreen').title=active?'Sair da tela cheia':'Modo tela cheia';
 if(!active){$('fullscreen-tools').classList.remove('open');$('fullscreen-menu-toggle').setAttribute('aria-expanded','false')}
 syncPageNavigation();
}
async function toggleFullscreen(){
 if(document.fullscreenElement||document.body.classList.contains('fullscreen-fallback')){await exitFullscreen();return}
 try{
  if(document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen();}
  else throw new Error('Fullscreen API indisponível neste navegador.');
  document.body.classList.add('fullscreen-mode');syncFullscreenState();
 }catch(err){
  document.body.classList.add('fullscreen-fallback');document.body.classList.add('fullscreen-mode');syncFullscreenState();
  showToast('Modo de tela cheia visual ativado. Para ocultar também as abas do navegador, use F11.',5500);
 }
}
async function exitFullscreen(){
 if(document.fullscreenElement&&document.exitFullscreen){try{await document.exitFullscreen()}catch{}}
 document.body.classList.remove('fullscreen-fallback','fullscreen-mode');syncFullscreenState();
}

function registerEvents(){
 $('pdf-input').addEventListener('change',e=>{const f=e.target.files[0];e.target.value='';openPdf(f)});
 $('btn-add').addEventListener('click',startPlacement);$('btn-export').addEventListener('click',()=>{if(githubLibrary?.hasActive())githubLibrary.saveActive().catch(()=>{});else exportPDF()});$('btn-download-copy').addEventListener('click',()=>exportPDF());$('btn-undo').addEventListener('click',undo);$('btn-redo').addEventListener('click',redo);
 $('btn-dark').addEventListener('click',()=>{document.body.classList.toggle('dark-ui');$('btn-dark').textContent=document.body.classList.contains('dark-ui')?'☀':'☾';$('btn-dark').title=document.body.classList.contains('dark-ui')?'Alternar para modo claro':'Alternar para modo escuro'});
 $('btn-select-text').addEventListener('click',()=>setTextSelectionMode(!state.selectionMode));
 $('btn-fullscreen').addEventListener('click',toggleFullscreen);$('fs-exit').addEventListener('click',exitFullscreen);
 $('fullscreen-menu-toggle').addEventListener('click',()=>{const menu=$('fullscreen-tools');menu.classList.toggle('open');$('fullscreen-menu-toggle').setAttribute('aria-expanded',String(menu.classList.contains('open')))});
 $('fs-select-text').addEventListener('click',()=>setTextSelectionMode(!state.selectionMode));$('fs-add-note').addEventListener('click',()=>{startPlacement();$('fullscreen-tools').classList.remove('open')});
 $('fs-mark-primary').addEventListener('click',()=>applyColorSlot('primary'));$('fs-mark-secondary').addEventListener('click',()=>applyColorSlot('secondary'));$('fs-mark-underline').addEventListener('click',()=>applyMark('underline',state.markColors.underline));
 document.addEventListener('fullscreenchange',syncFullscreenState);
 function setMarkOpacity(raw){
  const number=Number(raw);
  const value=Number.isFinite(number)?Math.round(clamp(number,10,100)):42;
  state.markOpacity=value/100;
  for(const id of ['mark-opacity','fs-mark-opacity'])$(id).value=String(value);
  for(const id of ['mark-opacity-value','fs-mark-opacity-value'])$(id).textContent=value+'%';
  $('mark-opacity-preview').style.setProperty('--preview-opacity',String(state.markOpacity));
 }
 for(const id of ['mark-opacity','fs-mark-opacity'])$(id).addEventListener('input',e=>setMarkOpacity(e.target.value));
 setMarkOpacity(42);
 $('mark-primary').addEventListener('input',e=>{state.markColors.primary=e.target.value;$('mark-opacity-preview').style.setProperty('--preview-color',state.markColors.primary);});
 $('mark-secondary').addEventListener('input',e=>state.markColors.secondary=e.target.value);
 $('mark-underline-color').addEventListener('input',e=>state.markColors.underline=e.target.value);
 $('mark-blue').addEventListener('click',()=>applyColorSlot('primary'));
 $('mark-yellow').addEventListener('click',()=>applyColorSlot('secondary'));
 for(const id of ['solid-shortcuts','fs-solid-shortcuts'])$(id).addEventListener('change',e=>setSolidShortcutMode(e.target.checked));
 setSolidShortcutMode(false);
 for(const id of ['quick-toolbar-enabled','fs-quick-toolbar-enabled'])$(id).addEventListener('change',e=>setQuickToolbarEnabled(e.target.checked));
 setQuickToolbarEnabled(false);
 $('mark-underline').addEventListener('click',()=>applyMark('underline',state.markColors.underline));
 // Quick actions obey the shared C/V solid-mode checkbox and current colors.
 $('quick-mark-primary').addEventListener('click',()=>applyColorSlot('primary'));
 $('quick-mark-secondary').addEventListener('click',()=>applyColorSlot('secondary'));
 $('quick-mark-underline').addEventListener('click',()=>applyMark('underline',state.markColors.underline));
 const quickBar=$('quick-mark-toolbar');
 // Clicking a toolbar control must not collapse the PDF selection before the
 // existing marking function reads the exact glyph-aligned selection range.
 quickBar.addEventListener('pointerdown',e=>{if(e.target.closest('button'))e.preventDefault()});
 quickBar.addEventListener('mousedown',e=>{if(e.target.closest('button'))e.preventDefault()});
 document.addEventListener('pointerdown',e=>{
  if(!quickBar.contains(e.target)&&!el.textLayer.contains(e.target))hideQuickMarkToolbar();
 },true);
 el.scroll.addEventListener('scroll',hideQuickMarkToolbar,{passive:true});
 window.addEventListener('resize',hideQuickMarkToolbar);

 $('prev-page').addEventListener('click',()=>setPage(state.page-1));$('next-page').addEventListener('click',()=>setPage(state.page+1));
 $('fs-prev-page').addEventListener('click',()=>setPage(state.page-1));$('fs-next-page').addEventListener('click',()=>setPage(state.page+1));
 const pageInput=$('page-number');
 pageInput.addEventListener('focus',()=>pageInput.select());
 pageInput.addEventListener('click',()=>pageInput.select());
 pageInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();commitPageNumber();pageInput.blur()}});
 pageInput.addEventListener('change',commitPageNumber);
 $('zoom-in').addEventListener('click',()=>{state.zoom=clamp(state.zoom+.15,.35,2.75);renderPage()});
 $('zoom-out').addEventListener('click',()=>{state.zoom=clamp(state.zoom-.15,.35,2.75);renderPage()});$('fit-width').addEventListener('click',fitWidth);
 $('placement-layer').addEventListener('click',e=>{
  if(!state.placing)return;const rect=el.pageContainer.getBoundingClientRect();state.pendingPoint={x:clamp((e.clientX-rect.left)/rect.width,.02,.98),y:clamp((e.clientY-rect.top)/rect.height,.02,.98)};openEditor();
 });
 for(const id of ['editor-close','note-cancel'])$(id).addEventListener('click',closeEditor);
 $('note-save').addEventListener('click',saveEditor);
 $('note-delete').addEventListener('click',()=>{if(!state.editingId)return;if(!confirm('Excluir esta nota?'))return;pushHistory();state.notes=state.notes.filter(n=>n.id!==state.editingId);pushHistory();state.pinned=false;state.openedPopup=null;closeEditor();renderPage();showToast('Nota removida. Salve o PDF para confirmar a exclusão no arquivo.')});
 $('popup-width').addEventListener('input',updateRangeOutputs);
 $('dialog-backdrop').addEventListener('click',e=>{if(e.target.id==='dialog-backdrop')closeEditor()});
 window.addEventListener('keydown',e=>{
  const focus=e.target instanceof Element?e.target:document.activeElement;
  const editing=!!focus?.closest?.('input, textarea, select, [contenteditable], [role="textbox"], [role="slider"]');
  if((e.key==='ArrowRight'||e.key==='ArrowLeft') && state.pdf&&!state.locked&&
    !e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.repeat&&
    !editing&&$('dialog-backdrop').classList.contains('hidden')){
   e.preventDefault();
   setPage(state.page+(e.key==='ArrowRight'?1:-1));return;
  }
  if(e.key==='Escape'){hideQuickMarkToolbar();if(!$('dialog-backdrop').classList.contains('hidden'))closeEditor();else if(state.placing)stopPlacement()}
  // On macOS Option changes e.key to symbols/dead keys (e.g. √, ∫, Dead).
  // Physical KeyboardEvent.code preserves the C/V/B shortcuts on both platforms.
  if(e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.repeat&&$('dialog-backdrop').classList.contains('hidden')&&!document.activeElement?.closest?.('input, textarea, select, [contenteditable="true"]')){
   const key=({KeyC:'c',KeyV:'v',KeyB:'b'})[e.code]||(['c','v','b'].includes(e.key.toLowerCase())?e.key.toLowerCase():null);
   if(key){e.preventDefault();e.stopPropagation();if(key==='c')applyColorSlot('primary');if(key==='v')applyColorSlot('secondary');if(key==='b')applyMark('underline',state.markColors.underline)}
  }
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&state.pdf){e.preventDefault();if(githubLibrary?.hasActive())githubLibrary.saveActive().catch(()=>{});else exportPDF();return}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!el.editor.contains(document.activeElement)){e.preventDefault();undo()}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'&&!el.editor.contains(document.activeElement)){e.preventDefault();redo()}
 });
 el.editor.addEventListener('mouseup',()=>{savedRange=selectionSave()});el.editor.addEventListener('keyup',()=>{savedRange=selectionSave()});
 document.addEventListener('selectionchange',()=>{const sel=window.getSelection();if(sel&&sel.rangeCount&&!sel.isCollapsed&&el.textLayer.contains(sel.anchorNode)&&el.textLayer.contains(sel.focusNode))savedPdfRange=sel.getRangeAt(0).cloneRange();updatePdfSelectionOverlay()});
 // Capture-phase observer works even if a PDF.js span uses native selection
 // and does not bubble pointerdown through the application's selection handler.
 document.addEventListener('pointerdown',beginQuickMarkGesture,true);
 document.addEventListener('pointermove',trackQuickMarkGesture,true);
 el.textLayer.addEventListener('pointerdown',beginPdfTextSelection);
 el.textLayer.addEventListener('dblclick',e=>{
  if(!state.selectionMode)return;
  e.preventDefault();
  // Reuse the existing PDF-glyph-aware word selection; no new mark algorithm.
  if(selectPdfWordAtPoint(e.clientX,e.clientY)&&state.quickToolbarEnabled){
   showQuickMarkToolbar(e.clientX,e.clientY);
  }
 });
 document.addEventListener('pointermove',movePdfTextSelection,true);
 document.addEventListener('pointerup',finishPdfTextSelection,true);
 document.addEventListener('pointercancel',finishPdfTextSelection,true);
 document.addEventListener('pointerup',finishQuickMarkGesture,true);
 document.addEventListener('pointercancel',finishQuickMarkGesture,true);
 $('mark-blue').addEventListener('mousedown',e=>e.preventDefault());$('mark-yellow').addEventListener('mousedown',e=>e.preventDefault());$('mark-underline').addEventListener('mousedown',e=>e.preventDefault());
 $('rich-toolbar').addEventListener('mousedown',e=>{if(e.target.closest('button')&&!e.target.closest('select,input'))e.preventDefault()});
 for(const b of document.querySelectorAll('[data-cmd]'))b.addEventListener('click',()=>cmd(b.dataset.cmd));
 $('font-family').addEventListener('change',e=>cmd('fontName',e.target.value));$('font-size').addEventListener('change',e=>applyFontSize(e.target.value));
 $('line-spacing').addEventListener('change',updateEditorSpacing);$('paragraph-spacing').addEventListener('change',updateEditorSpacing);
 setupColorPalettes();
 $('insert-table').addEventListener('click',()=>insertHTML('<table><tbody><tr><th>Coluna 1</th><th>Coluna 2</th></tr><tr><td>Texto</td><td>Texto</td></tr></tbody></table><p><br></p>'));
 $('insert-rule').addEventListener('click',()=>insertHTML('<hr><p><br></p>'));
 $('insert-image').addEventListener('click',()=>{$('image-input').click()});
 $('image-input').addEventListener('change',async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  if(f.size>8*1048576){showToast('Cada imagem deve ter até 8 MB. Reduza o tamanho antes de inserir.');return}
  if(!/^image\/(png|jpeg|webp|gif)$/.test(f.type)){showToast('Formato não suportado: use PNG, JPG ou WebP.');return}
  const reader=new FileReader();reader.onload=()=>insertHTML(wrapImageWithHandle(String(reader.result)));reader.readAsDataURL(f);
 });
 el.editor.addEventListener('paste',async e=>{
  const items=[...(e.clipboardData?.items||[])];const imageItem=items.find(i=>i.type.startsWith('image/'));
  if(imageItem){e.preventDefault();const file=imageItem.getAsFile();if(!file)return;if(file.size>8*1048576){showToast('Imagem colada acima de 8 MB.');return;}const reader=new FileReader();reader.onload=()=>insertHTML(wrapImageWithHandle(String(reader.result)));reader.readAsDataURL(file);return;}
  setTimeout(()=>wrapLooseImages(),0);
 });
 el.editor.addEventListener('input',wrapLooseImages);

 el.scroll.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault()});
 el.scroll.addEventListener('drop',e=>{const f=e.dataTransfer.files?.[0];if(f&&(/\.pdf$/i.test(f.name)||f.type==='application/pdf')){e.preventDefault();openPdf(f)}});
 enableMediaResize();
}
registerEvents();setTextSelectionMode(true);$('btn-dark').textContent='☀';$('btn-dark').title='Alternar para modo claro';status('Pronto: abra um PDF da pasta do GitHub ou do computador.');
githubLibrary=initGitHubLibrary({onOpen:openPdf,onSave:()=>exportPDF('github'),onSaved:result=>{savedSnapshot=result.snapshot;status('PDF atualizado e confirmado no GitHub.')},isDirty:()=>!!state.pdf&&editorSnapshot()!==savedSnapshot,showToast});
// Useful to automated integration tests without exposing document files to servers.
window.NotaPDFStudio = Object.freeze({appVersion:'1.9.5',getInfo:()=>({page:state.page,total:state.pdf?.numPages||0,notes:state.notes.length,loaded:!!state.pdf}),openPdfFile:openPdf,exportPdf:exportPDF,setTextSelectionMode,drawOriginalAnnotations,annotationColor,annotationQuads,buildPdfTextIndex,wordForCaret,pointToPdfPosition,selectPdfWordAtPoint,drawBurnedMarks,pdfAnchoredClientRects,burnMarksOverPageContent,burnSolidMarks,solidPatch,burnMarksBehindPageText:burnMarksOverPageContent,selectionRects});
