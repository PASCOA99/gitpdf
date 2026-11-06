/** GitHub REST API adapter. Never put a PAT in the repository or a URL. */
export const PDF_ROOT = 'PDFs editáveis';
const API = 'https://api.github.com';
const ACCEPT = 'application/vnd.github+json';

export function validateConfig(input) {
  const c = { owner:String(input.owner || '').trim(), repo:String(input.repo || '').trim(), branch:String(input.branch || 'main').trim(), pdfRoot:PDF_ROOT };
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(c.owner)) throw new Error('Usuário/organização do GitHub inválido.');
  if (!/^[a-z\d_.-]{1,100}$/i.test(c.repo) || c.repo==='.' || c.repo==='..') throw new Error('Nome do repositório inválido.');
  if (!c.branch || /[\x00-\x20\x7f~^:?*\[\\]/.test(c.branch) || c.branch.startsWith('/') || c.branch.endsWith('/') || c.branch.includes('..') || c.branch.includes('//')) throw new Error('Branch inválida.');
  return c;
}
export function pathSegments(path) {
  const segments=String(path).split('/');
  if (!segments.length || segments.some(x => !x || x==='.' || x==='..' || x.includes('\\'))) throw new Error('Caminho inválido.');
  return segments;
}
export function encodePath(path) { return pathSegments(path).map(encodeURIComponent).join('/'); }
export function underPdfRoot(path, root=PDF_ROOT) { return path===root || path.startsWith(root+'/'); }

/** Supports big PDFs without overloading String.fromCharCode or btoa's argument list. */
export function bytesToBase64(input) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  const chunkSize=12288; // Divisible by 3, so intermediate chunks are never padded.
  const result=[];
  for(let i=0;i<bytes.length;i+=chunkSize){
    const chunk=bytes.subarray(i,i+chunkSize);
    let binary='';
    for(let j=0;j<chunk.length;j++)binary+=String.fromCharCode(chunk[j]);
    result.push(btoa(binary));
  }
  return result.join('');
}
export function base64ToBytes(content) {
  const base64=String(content).replace(/\s/g,'');
  if(base64.length%4===1 || /[^A-Za-z0-9+/=]/.test(base64))throw new Error('Conteúdo Base64 inválido.');
  const result=new Uint8Array(Math.floor(base64.length*3/4)-(base64.endsWith('==')?2:base64.endsWith('=')?1:0));
  const size=16384;let position=0;
  for(let i=0;i<base64.length;i+=size){
    const decoded=atob(base64.slice(i,i+size));
    for(let j=0;j<decoded.length;j++)result[position++]=decoded.charCodeAt(j);
  }
  if(position!==result.length)throw new Error('Falha na decodificação do PDF.');
  return result;
}

export class GitHubError extends Error {
  constructor(message,status){super(message);this.name='GitHubError';this.status=status;}
}
export class GitHubRepository {
  constructor(config,{tokenProvider=()=>'',fetcher=fetch}={}) {
    this.config=validateConfig(config);
    this.tokenProvider=tokenProvider;
    this.fetcher=fetcher;
    this.base=`${API}/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}`;
  }
  async request(endpoint,{method='GET',body,accept=ACCEPT}={}) {
    const token=this.tokenProvider();
    const headers={'Accept':accept,'X-GitHub-Api-Version':'2022-11-28'};
    if(token)headers.Authorization=`Bearer ${token}`;
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await this.fetcher(this.base+endpoint,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
    if(!response.ok){
      let detail='';try{const json=await response.json();detail=String(json?.message||'').slice(0,220)}catch{}
      if(response.status===401)throw new GitHubError('Token inválido ou expirado.',401);
      if(response.status===403)throw new GitHubError('Acesso negado ou limite de requisições do GitHub atingido. Confira as permissões do token.',403);
      if(response.status===404)throw new GitHubError('Pasta/arquivo não encontrado ou repositório sem acesso. Confira proprietário, repositório, branch e token.',404);
      if(response.status===409)throw new GitHubError('Conflito: o arquivo mudou no GitHub. Reabra a versão mais recente antes de salvar.',409);
      if(response.status===422)throw new GitHubError('GitHub recusou a atualização (arquivo, versão ou tamanho inválido). '+detail,422);
      throw new GitHubError(`GitHub respondeu HTTP ${response.status}. ${detail}`,response.status);
    }
    return response;
  }
  contentEndpoint(path){
    if(!underPdfRoot(path))throw new Error('Acesso fora da pasta PDFs editáveis bloqueado.');
    return `/contents/${encodePath(path)}`;
  }
  async list(path=PDF_ROOT) {
    const res=await this.request(`${this.contentEndpoint(path)}?ref=${encodeURIComponent(this.config.branch)}`);
    const data=await res.json();
    if(!Array.isArray(data))throw new Error('O caminho escolhido não é uma pasta.');
    return data.filter(entry=>entry && underPdfRoot(entry.path) && (entry.type==='dir' || (entry.type==='file' && /\.pdf$/i.test(entry.name)))).sort((a,b)=>{
      if(a.type!==b.type)return a.type==='dir'?-1:1;
      return a.name.localeCompare(b.name,'pt-BR',{numeric:true,sensitivity:'base'});
    });
  }
  async fileMetadata(path){
    if(!/\.pdf$/i.test(path))throw new Error('Apenas PDFs podem ser abertos.');
    const res=await this.request(`${this.contentEndpoint(path)}?ref=${encodeURIComponent(this.config.branch)}`);
    const data=await res.json();
    if(data.type!=='file' || !data.sha)throw new Error('Arquivo PDF não encontrado.');
    return data;
  }
  async readBlob(sha) {
    if(!/^[a-f0-9]{40,64}$/i.test(sha))throw new Error('SHA do arquivo inválido.');
    const res=await this.request(`/git/blobs/${sha}`,{accept:'application/vnd.github.raw+json'});
    // GitHub normally returns raw bytes. Some proxies return the JSON/base64 representation.
    const type=res.headers?.get?.('content-type')||'';
    const bytes=type.includes('application/json')?base64ToBytes((await res.json()).content):new Uint8Array(await res.arrayBuffer());
    if(!bytes.length || bytes.length>100*1024*1024)throw new Error('PDF vazio ou acima do limite de 100 MB da API do GitHub.');
    return bytes;
  }
  async readFile(entry){
    const meta=await this.fileMetadata(entry.path); // Read up-to-date SHA (not stale folder listing).
    const bytes=await this.readBlob(meta.sha);
    if(bytes.length<5 || String.fromCharCode(...bytes.subarray(0,5))!=='%PDF-')throw new Error('O arquivo não tem assinatura PDF válida.');
    return {bytes,sha:meta.sha,name:meta.name,path:meta.path};
  }
  async overwrite(path,expectedSha,bytes) {
    if(!/\.pdf$/i.test(path)||!underPdfRoot(path)||!/^[a-f0-9]{40,64}$/i.test(expectedSha))throw new Error('Arquivo de origem inválido.');
    const now=await this.fileMetadata(path);
    if(now.sha!==expectedSha)throw new GitHubError('Este PDF já foi modificado no GitHub. Suas alterações NÃO foram sobrescritas. Reabra o PDF atualizado antes de salvar.',409);
    if(bytes.length>100*1024*1024)throw new Error('O PDF exportado ultrapassa o limite de 100 MB do GitHub.');
    const content=bytesToBase64(bytes);
    const res=await this.request(this.contentEndpoint(path),{
      method:'PUT',body:{message:`Atualiza PDF: ${path} (NotaPDF Studio)`,content,sha:expectedSha,branch:this.config.branch}
    });
    const data=await res.json();
    if(!data?.content?.sha)throw new Error('O GitHub não confirmou o SHA do PDF atualizado. Confira o repositório.');
    return {sha:data.content.sha,commitSha:data.commit?.sha || ''};
  }
}
