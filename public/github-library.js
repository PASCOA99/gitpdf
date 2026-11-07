import {PDF_ROOT,OnlineRepository,getConfig,getSession,logout} from './github-api.js';

/** Only browsing and persistence. Editor/export functions are owned by app.js. */
const $=id=>document.getElementById(id);
const clear=node=>node.replaceChildren();
function makeButton(label,className,onClick,title=''){
 const b=document.createElement('button');b.type='button';b.className=className;b.textContent=label;b.title=title;b.addEventListener('click',onClick);return b;
}
export function initGitHubLibrary({onOpen,onSave,onSaved,isDirty,showToast}){
 let config=null,repository=null,active=null,saving=false,opening=false,session={authenticated:false,login:null};
 const tree=$('gh-tree'),selected=$('gh-selected');
 const status=(message,isError=false)=>{const node=$('gh-status');node.textContent=message;node.classList.toggle('gh-error',isError)};
 function updateActive(){
  selected.textContent=active?active.path:'Nenhum PDF do GitHub aberto';selected.title=active?.path||'';
  $('btn-export').textContent=active?'⇧  Salvar no GitHub':'↓  Salvar PDF';
  $('btn-export').title=active?'Substituir o PDF no mesmo caminho (sem download)':'Baixar cópia do PDF avulso';
  $('btn-download-copy').disabled=$('pdf-stage').classList.contains('hidden');
  for(const el of tree.querySelectorAll('[data-gh-path]'))el.classList.toggle('gh-active',el.dataset.ghPath===active?.path);
 }
 function setActive(value){active=value||null;updateActive()}
 async function refreshSession(){
  try{session=await getSession()}catch{session={authenticated:false,login:null}}
  $('gh-login').hidden=!!session.authenticated;
  $('gh-logout').hidden=!session.authenticated;
  $('gh-user').textContent=session.authenticated?`Conectado: ${session.login}`:'Leitura pública · entre para salvar';
  if($('gh-install')){$('gh-install').hidden=!config?.appInstallUrl;$('gh-install').href=config?.appInstallUrl||'#'}
 }
 async function loadFolder(path,node){
  const entries=await repository.list(path);clear(node);
  if(!entries.length){const text=document.createElement('p');text.className='gh-empty';text.textContent='Sem PDFs nesta pasta.';node.append(text);return}
  for(const entry of entries){
   const row=document.createElement('div');row.className='gh-entry';
   const line=document.createElement('div');line.className='gh-entry-line';
   if(entry.type==='dir'){
    const children=document.createElement('div');children.className='gh-children';children.hidden=true;
    let expanded=false,loaded=false;
    const button=makeButton('▸  📁 '+entry.name,'gh-entry-button gh-folder',async()=>{
     expanded=!expanded;button.textContent=(expanded?'▾  📂 ':'▸  📁 ')+entry.name;
     button.setAttribute('aria-expanded',String(expanded));children.hidden=!expanded;
     if(expanded&&!loaded){button.disabled=true;try{await loadFolder(entry.path,children);loaded=true}catch(err){children.textContent=err.message;status(err.message,true)}finally{button.disabled=false}}
    },'Abrir ou fechar subpasta');
    button.setAttribute('aria-expanded','false');line.append(button);row.append(line,children);
   }else{
    const button=makeButton('📄 '+entry.name,'gh-entry-button gh-file',async()=>{
     if(opening||saving)return;
     if(active&&isDirty?.()&&!confirm('Há marcações não salvas. Abrir outro PDF e descartar essas alterações?'))return;
     opening=true;button.disabled=true;status('Abrindo documento da biblioteca…');
     try{
      const source=await repository.readFile(entry),file=new File([source.bytes],source.name,{type:'application/pdf'});
      const opened=await onOpen(file,{path:source.path,sha:source.sha});
      if(opened===false)throw new Error('O editor não conseguiu abrir este PDF.');
      setActive({path:source.path,sha:source.sha,owner:config.owner,repo:config.repo,branch:config.branch});
      status('Documento aberto: '+source.name);showToast('PDF aberto diretamente do GitHub.');
     }catch(err){status(err.message,true);showToast('Erro ao abrir PDF: '+err.message)}
     finally{opening=false;button.disabled=false}
    },entry.path);
    button.dataset.ghPath=entry.path;
    if(entry.path===active?.path)button.classList.add('gh-active');
    line.append(button);row.append(line);
   }
   node.append(row);
  }
 }
 async function refresh(){
  clear(tree);if(!repository){status('Configure e publique o Worker com GITHUB_OWNER e GITHUB_REPO.',true);return}
  const heading=document.createElement('div');heading.className='gh-root-heading';heading.textContent='📁 '+PDF_ROOT;
  const content=document.createElement('div');content.className='gh-root';tree.append(heading,content);
  status('Atualizando biblioteca…');
  try{await loadFolder(PDF_ROOT,content);status(`${config.owner}/${config.repo} · ${config.branch}`)}
  catch(err){status('Não foi possível carregar a biblioteca: '+err.message,true);content.textContent='Verifique a configuração do Worker e a pasta PDFs editáveis no GitHub.'}
 }
 async function saveActive(){
  if(saving)return;if(!active)throw new Error('Abra primeiro um PDF da biblioteca.');
  if(!session.authenticated){status('Entre com GitHub para salvar.',true);showToast('Clique em Entrar com GitHub para salvar no repositório.');return}
  saving=true;$('btn-export').disabled=true;status('Gerando PDF com as marcações e notas…');
  try{
   const result=await onSave();
   if(!result?.bytes)throw new Error('Exportação do editor não produziu PDF válido. Nada foi alterado.');
   status('Gravando PDF no mesmo caminho do GitHub…');
   const write=await repository.overwrite(active.path,active.sha,result.bytes);
   if(!write?.sha)throw new Error('O servidor não confirmou a gravação no GitHub.');
   active.sha=write.sha;onSaved?.(result);
   status('Salvo no GitHub ✓ · '+active.path);showToast('PDF sobrescrito no GitHub com as marcações anteriores e novas.');
  }catch(err){status('Falha ao salvar: '+err.message,true);showToast('O PDF não foi sobrescrito. '+err.message);throw err}
  finally{saving=false;$('btn-export').disabled=$('pdf-stage').classList.contains('hidden')}
 }
 $('gh-refresh').addEventListener('click',refresh);
 $('gh-login').addEventListener('click',()=>{location.assign('/auth/login')});
 $('gh-logout').addEventListener('click',async()=>{try{await logout();await refreshSession();status('Saiu do GitHub. Os PDFs públicos continuam acessíveis.')}catch(err){status(err.message,true)}});
 (async()=>{
  try{config=await getConfig();repository=new OnlineRepository(config);await refreshSession();await refresh()}
  catch(err){status('Configuração do serviço: '+err.message,true);await refreshSession()}
 })();
 return {setActive,saveActive,refresh,hasActive:()=>!!active,getActive:()=>active};
}
