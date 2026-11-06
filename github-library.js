import {PDF_ROOT,GitHubRepository,validateConfig} from './github-api.js';

/** Presentation only: the PDF editor's marks, notes, export and undo engines remain in app.js. */
const $ = id=>document.getElementById(id);
const KEY='notapdf-github-repository-v1';
function autodetect(){
  const host=location.hostname.match(/^([a-z\d-]+)\.github\.io$/i);
  if(!host)return null;
  const repo=decodeURIComponent(location.pathname.split('/').filter(Boolean)[0]||host[1]+'.github.io');
  return {owner:host[1],repo,branch:'main',pdfRoot:PDF_ROOT};
}
function status(message,error=false){const node=$('gh-status');node.textContent=message;node.classList.toggle('gh-error',error);}
function clear(node){node.replaceChildren()}
function button(label,css,click,title=''){
  const node=document.createElement('button');node.type='button';node.className=css;node.textContent=label;
  if(title)node.title=title;
  node.addEventListener('click',click);return node;
}
function readLocalSettings(){try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch{return null}}
function storeLocalSettings(config){try{localStorage.setItem(KEY,JSON.stringify(config))}catch{}}

export function initGitHubLibrary({onOpen,onSave,onSaved,isDirty,showToast}) {
  let settings=null,repository=null,token='',active=null,saving=false,opening=false,tokenResolver=null;
  const selected=$('gh-selected'),tree=$('gh-tree'),tokenDialog=$('gh-token-dialog'),configDialog=$('gh-config-dialog');

  function updateActive(){
    selected.textContent=active?active.path:'Nenhum PDF do GitHub aberto';
    selected.title=active?.path||'';
    $('btn-export').textContent=active?'⇧  Salvar no GitHub':'↓  Salvar PDF';
    $('btn-export').title=active?'Substituir no repositório o PDF aberto':'Baixar o PDF local editado';
    $('btn-download-copy').disabled=$('pdf-stage').classList.contains('hidden');
    for(const b of tree.querySelectorAll('[data-gh-path]'))b.classList.toggle('gh-active',b.dataset.ghPath===active?.path);
  }
  function setActive(source){active=source||null;updateActive()}
  function makeRepo(){
    if(!settings)return null;
    try{repository=new GitHubRepository(settings,{tokenProvider:()=>token});return repository}
    catch(err){repository=null;status(err.message,true);return null}
  }
  function displayConfig(){
    $('gh-owner').value=settings?.owner||'';
    $('gh-repo').value=settings?.repo||'';
    $('gh-branch').value=settings?.branch||'main';
    configDialog.showModal();
  }
  function openTokenDialog(){
    $('gh-token-input').value='';$('gh-token-connect').textContent=token?'Trocar token':'Conectar token';
    tokenDialog.showModal();
  }
  async function ensureToken(){
    if(token)return true;
    return new Promise(resolve=>{tokenResolver=resolve;openTokenDialog()});
  }
  async function loadFolder(path,children) {
    if(!repository)throw new Error('Configure o repositório do GitHub.');
    const entries=await repository.list(path);
    clear(children);
    if(!entries.length){const empty=document.createElement('p');empty.className='gh-empty';empty.textContent='Pasta sem arquivos PDF.';children.append(empty);return}
    for(const entry of entries){
      const row=document.createElement('div');row.className='gh-entry';
      const isDir=entry.type==='dir';
      const content=document.createElement('div');content.className='gh-entry-line';
      const childContainer=document.createElement('div');childContainer.className='gh-children';childContainer.hidden=true;
      if(isDir){
        let expanded=false,loaded=false;
        const control=button('▸  📁 '+entry.name,'gh-entry-button gh-folder',async()=>{
          expanded=!expanded;
          control.setAttribute('aria-expanded',String(expanded));
          control.textContent=(expanded?'▾  📂 ':'▸  📁 ')+entry.name;
          childContainer.hidden=!expanded;
          if(expanded&&!loaded){
            control.disabled=true;
            try{await loadFolder(entry.path,childContainer);loaded=true}
            catch(err){childContainer.textContent=err.message;status(err.message,true)}
            finally{control.disabled=false}
          }
        },'Abrir ou recolher subpasta');
        control.setAttribute('aria-expanded','false');
        content.append(control);
      }else{
        const control=button('📄 '+entry.name,'gh-entry-button gh-file',async()=>{
          if(opening||saving)return;
          opening=true;control.disabled=true;status('Abrindo PDF do GitHub…');
          try{
            const source=await repository.readFile(entry);
            const name=source.name;
            const file=new File([source.bytes],name,{type:'application/pdf'});
            const origin={owner:repository.config.owner,repo:repository.config.repo,branch:repository.config.branch,path:source.path,sha:source.sha};
            const opened=await onOpen(file,origin);
            if(opened!==false){setActive(origin);status('PDF aberto: '+entry.name);showToast('Documento carregado da pasta do GitHub.');}
            else status('Não foi possível abrir o PDF.',true);
          }catch(err){status(err.message,true);showToast('Erro ao abrir do GitHub: '+err.message)}
          finally{opening=false;control.disabled=false}
        },entry.path);
        control.dataset.ghPath=entry.path;
        if(active?.path===entry.path)control.classList.add('gh-active');
        content.append(control);
      }
      row.append(content);
      if(isDir)row.append(childContainer);
      children.append(row);
    }
  }
  async function refresh(){
    clear(tree);
    if(!repository){status('Configure o repositório para ver os PDFs.');return}
    status('Atualizando pastas do GitHub…');
    const root=document.createElement('div');root.className='gh-root';
    const heading=document.createElement('div');heading.className='gh-root-heading';heading.textContent='📁 '+PDF_ROOT;tree.append(heading,root);
    try{await loadFolder(PDF_ROOT,root);status(`${repository.config.owner}/${repository.config.repo} · ${repository.config.branch}`)}
    catch(err){status(err.message,true);root.textContent='Não foi possível carregar a biblioteca. Verifique as configurações ou conecte um token.'}
  }
  async function saveActive(){
    if(saving)return;
    if(!active)throw new Error('Abra primeiro um PDF da biblioteca do GitHub.');
    if(!repository || active.owner!==repository.config.owner || active.repo!==repository.config.repo || active.branch!==repository.config.branch)
      throw new Error('O repositório foi alterado. Reabra o PDF no repositório de origem antes de salvar.');
    if(!await ensureToken()){status('Salvamento cancelado: token não informado.',true);return}
    saving=true;
    $('btn-export').disabled=true;
    status('Verificando a versão do PDF…');
    try{
      // Refuse to write when the file changed since this editor opened it.
      const remoteMeta=await repository.fileMetadata(active.path);
      if(remoteMeta.sha!==active.sha)throw new Error('O PDF mudou no GitHub desde que você o abriu. Nada foi sobrescrito. Reabra o PDF atualizado.');
      const result=await onSave(); // reuse the existing exporter; no local file download
      if(!result?.bytes)throw new Error('A exportação não produziu um PDF validado. Nada foi enviado.');
      status('Enviando PDF validado ao GitHub…');
      const write=await repository.overwrite(active.path,active.sha,result.bytes);
      active.sha=write.sha;
      onSaved?.(result);
      status('PDF salvo no GitHub ✓ · '+active.path);
      showToast('Salvo no GitHub! O PDF anterior foi substituído pelo arquivo com suas marcações.');
    }catch(err){
      status('Falha ao salvar: '+err.message,true);
      showToast('O arquivo do GitHub não foi substituído. '+err.message);
      throw err;
    }finally{saving=false;$('btn-export').disabled=$('pdf-stage').classList.contains('hidden')}
  }

  $('gh-refresh').addEventListener('click',refresh);
  $('gh-config').addEventListener('click',displayConfig);
  $('gh-token').addEventListener('click',openTokenDialog);
  $('gh-clear-token').addEventListener('click',()=>{token='';$('gh-token-input').value='';status('Token apagado da memória desta aba.');});
  $('gh-config-save').addEventListener('click',async()=>{
    try{
      const newSettings=validateConfig({owner:$('gh-owner').value,repo:$('gh-repo').value,branch:$('gh-branch').value});
      settings=newSettings;storeLocalSettings(settings);makeRepo();configDialog.close();await refresh();
    }catch(err){$('gh-config-error').textContent=err.message}
  });
  $('gh-config-cancel').addEventListener('click',()=>configDialog.close());
  configDialog.addEventListener('close',()=>{$('gh-config-error').textContent='' });
  $('gh-token-connect').addEventListener('click',()=>{
    token=$('gh-token-input').value.trim();$('gh-token-input').value='';tokenDialog.close();
    status(token?'Token conectado apenas nesta aba.':'Nenhum token informado.');
  });
  $('gh-token-cancel').addEventListener('click',()=>tokenDialog.close());
  tokenDialog.addEventListener('close',()=>{
    $('gh-token-input').value='';
    if(tokenResolver){const resolve=tokenResolver;tokenResolver=null;resolve(!!token)}
  });
  $('gh-token-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('gh-token-connect').click()}});
  (async()=>{
    let fileConfig={};
    try{const r=await fetch('./config.json',{cache:'no-store'});if(r.ok)fileConfig=await r.json()}catch{}
    const inferred=autodetect()||{};
    settings={...fileConfig,...inferred,...(readLocalSettings()||{}),pdfRoot:PDF_ROOT};
    makeRepo();
    if(repository)await refresh();else status('Clique em ⚙ para configurar seu repositório.');
  })().catch(err=>status(err.message,true));
  return {setActive,saveActive,refresh,hasActive:()=>!!active,getActive:()=>active};
}
