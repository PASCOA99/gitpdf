/** No token, no GitHub API from the browser: requests go to the same-origin Worker. */
export const PDF_ROOT='PDFs editáveis';
export function checkPath(path, file=false){
 if(typeof path!=='string'||path.length>1000||path.includes('\\'))throw new Error('Caminho inválido.');
 const parts=path.split('/');
 if(parts[0]!==PDF_ROOT||parts.some(p=>!p||p==='.'||p==='..'))throw new Error('O PDF precisa estar na pasta PDFs editáveis.');
 if(file && (parts.length<2||!/\.pdf$/i.test(path)))throw new Error('Apenas arquivos PDF podem ser abertos.');
 return path;
}
async function api(path,options){
 // Always use the built-in fetch as a plain function: prevents "Illegal invocation".
 const res=await fetch(path,{cache:'no-store',credentials:'same-origin',...options});
 if(!res.ok){let err;try{err=await res.json()}catch{}throw new Error(err?.error||`Servidor retornou HTTP ${res.status}.`)}
 return res;
}
export class OnlineRepository {
 constructor(config){
  this.config=config;
  if(!config?.owner||!config?.repo)throw new Error('Repositório não configurado no servidor.');
 }
 async list(path=PDF_ROOT){checkPath(path);const r=await api('/api/tree?'+new URLSearchParams({path}));return r.json()}
 async readFile(entry){
  checkPath(entry.path,true);
  const r=await api('/api/pdf?'+new URLSearchParams({path:entry.path}));
  const sha=r.headers.get('X-NPS-SHA');if(!/^[a-f0-9]{40}$/i.test(sha||''))throw new Error('O servidor não informou a versão original do PDF.');
  const bytes=new Uint8Array(await r.arrayBuffer());
  if(bytes.length<5||new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw new Error('O arquivo recebido não é um PDF.');
  return {name:entry.name,path:entry.path,sha,bytes};
 }
 async overwrite(path,sha,bytes){
  checkPath(path,true);
  if(!/^[a-f0-9]{40}$/i.test(sha||''))throw new Error('Versão original do PDF inválida.');
  const r=await api('/api/pdf?'+new URLSearchParams({path}),{
   method:'PUT',headers:{'Content-Type':'application/pdf','X-Expected-Sha':sha,'X-NPS-Request':'1'},body:bytes
  });return r.json();
 }
}
export async function getConfig(){return (await api('/api/config')).json()}
export async function getSession(){return (await api('/api/session')).json()}
export async function logout(){await api('/auth/logout',{method:'POST',headers:{'X-NPS-Request':'1'}})}
