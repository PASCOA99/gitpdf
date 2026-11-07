/**
 * NotaPDF Studio 2.0 - same-origin Cloudflare Worker + GitHub App (OAuth user flow).
 * Only proxies the configured repository's PDFs editáveis folder. No GitHub token is
 * ever exposed to the frontend; the browser has an encrypted HttpOnly session cookie.
 * The PDF manipulation engine lives unchanged in public/core.js and public/app.js.
 */
const ROOT = 'PDFs editáveis';
const MAX_PDF = 20 * 1024 * 1024; // Limit keeps within practical Worker RAM / request overhead.
const SESSION_COOKIE = '__Host-nps_session';
const FLOW_COOKIE = '__Host-nps_flow';
const API_GITHUB = 'https://api.github.com';
const encoder = new TextEncoder();

function result(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
}
function failure(message,status=400){return result({error:message},status)}
function pathParts(path) {
  if (typeof path !== 'string' || path.length > 1000 || path.includes('\\') || path.includes('\0')) throw new HttpError('Caminho inválido.',400);
  const parts=path.split('/');
  if (parts[0]!==ROOT || parts.some(p=>!p||p==='.'||p==='..'||p.length>240))throw new HttpError('Acesso fora da pasta PDFs editáveis.',400);
  return parts;
}
function pdfPath(path){const parts=pathParts(path);if(parts.length<2||!path.toLowerCase().endsWith('.pdf'))throw new HttpError('Selecione um arquivo PDF na biblioteca.',400);return path;}
function encodePath(path){return pathParts(path).map(encodeURIComponent).join('/')}
function repoConfig(env){
  const owner=String(env.GITHUB_OWNER||'');const repo=String(env.GITHUB_REPO||'');const branch=String(env.GITHUB_BRANCH||'main');
  if(!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(owner) || !/^[a-z\d_.-]{1,100}$/i.test(repo) || repo==='.'||repo==='..'|| !branch || /[\x00-\x20\x7f~^:?*\[\\]/.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/'))throw new HttpError('Configure GITHUB_OWNER, GITHUB_REPO e GITHUB_BRANCH no Wrangler.',503);
  if(owner.startsWith('TROQUE-')||repo.startsWith('TROQUE-'))throw new HttpError('Configure GITHUB_OWNER e GITHUB_REPO no wrangler.jsonc antes de publicar.',503);
  return {owner,repo,branch,pdfRoot:ROOT,appInstallUrl: /^[a-z\d-]+$/i.test(env.GITHUB_APP_SLUG||'')&&!env.GITHUB_APP_SLUG.startsWith('TROQUE-')?`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`:null};
}
function cookie(request,key){
  const all=request.headers.get('Cookie')||'';
  const part=all.split(';').map(v=>v.trim()).find(v=>v.startsWith(key+'='));
  return part?part.slice(key.length+1):'';
}
const to64=bytes=>btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function from64(b){const s=b.replace(/-/g,'+').replace(/_/g,'/');const x=atob(s+'='.repeat((4-s.length%4)%4));return Uint8Array.from(x,ch=>ch.charCodeAt(0));}
const safeEqual=(a,b)=>{if(a.length!==b.length)return false;let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);return mismatch===0;};
const flowCookie=v=>`${FLOW_COOKIE}=${v}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`;
const sessionCookie=v=>`${SESSION_COOKIE}=${v}; Path=/; Max-Age=${150*86400}; HttpOnly; Secure; SameSite=Lax`;
const clearCookie=key=>`${key}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
function random(){const a=new Uint8Array(32);crypto.getRandomValues(a);return to64(a)}
function secretKey(env){if(!env.SESSION_KEY)throw new HttpError('Configure o segredo SESSION_KEY no Cloudflare Worker.',503);let bytes;try{bytes=from64(env.SESSION_KEY)}catch{}if(!bytes||bytes.length!==32)throw new HttpError('SESSION_KEY deve conter 32 bytes aleatórios em Base64.',503);return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt'])}
async function seal(data,env){
  const key=await secretKey(env),nonce=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,encoder.encode(JSON.stringify(data))));
  return to64(nonce)+'.'+to64(ct);
}
async function unseal(value,env){
  if(!value||!value.includes('.'))return null;
  try{
    const [n,c]=value.split('.');const nonce=from64(n);if(nonce.length!==12)return null;
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},await secretKey(env),from64(c));
    const data=JSON.parse(new TextDecoder().decode(plaintext));
    return data && typeof data.accessToken==='string' && typeof data.login==='string'?data:null;
  }catch{return null}
}
function noCrossOriginPost(request){
  const origin=request.headers.get('Origin');const url=new URL(request.url);
  if((origin&&origin!==url.origin)||(request.headers.get('Sec-Fetch-Site')&&!['same-origin','none'].includes(request.headers.get('Sec-Fetch-Site')))||request.headers.get('X-NPS-Request')!=='1')throw new HttpError('Requisição de gravação não autorizada pela origem.',403);
}
class HttpError extends Error{constructor(message,status=400){super(message);this.status=status}}
async function exchange(body,env){
  if(!env.GITHUB_APP_CLIENT_ID||!env.GITHUB_APP_CLIENT_SECRET)throw new HttpError('Configure as credenciais da GitHub App no Worker.',503);
  const res=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GITHUB_APP_CLIENT_ID,client_secret:env.GITHUB_APP_CLIENT_SECRET,...body})});
  const data=await res.json();if(!res.ok||data.error||!data.access_token)throw new HttpError('O GitHub não autorizou a sessão: '+String(data.error_description||data.error||'erro OAuth').slice(0,150),401);
  return data;
}
function sessionFromAuth(data,login){
  const now=Date.now();
  return {accessToken:data.access_token,refreshToken:data.refresh_token||'',accessExpiry:data.expires_in?now+data.expires_in*1000:null,refreshExpiry:data.refresh_token_expires_in?now+data.refresh_token_expires_in*1000:null,login};
}
async function currentSession(request,env){
  let session=await unseal(cookie(request,SESSION_COOKIE),env);
  if(!session)return {session:null,setCookie:null};
  if(session.accessExpiry && session.accessExpiry-Date.now()<120000){
    if(!session.refreshToken || (session.refreshExpiry&&session.refreshExpiry<Date.now()))return {session:null,setCookie:clearCookie(SESSION_COOKIE)};
    try{const data=await exchange({grant_type:'refresh_token',refresh_token:session.refreshToken},env);session=sessionFromAuth(data,session.login);return {session,setCookie:sessionCookie(await seal(session,env))}}
    catch{return {session:null,setCookie:clearCookie(SESSION_COOKIE)}}
  }
  return {session,setCookie:null};
}
function appendCookie(response,value){if(!value)return response;const copy=new Response(response.body,response);copy.headers.append('Set-Cookie',value);return copy}
function redirect(url,cookies=[]){const response=Response.redirect(url,302);const copy=new Response(response.body,response);for(const c of cookies)copy.headers.append('Set-Cookie',c);copy.headers.set('Cache-Control','no-store');return copy}
async function github(endpoint,session,options={}){
  const headers=new Headers({'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'NotaPDF-Studio-Online'});
  if(session?.accessToken)headers.set('Authorization',`Bearer ${session.accessToken}`);
  if(options.body!==undefined)headers.set('Content-Type','application/json');
  const response=await fetch(API_GITHUB+endpoint,{method:options.method||'GET',headers,body:options.body===undefined?undefined:JSON.stringify(options.body),redirect:'manual'});
  if(!response.ok){
    const detail=await response.json().catch(()=>({}));
    const code=response.status;
    let message=code===401?'Login do GitHub expirado. Entre novamente.':code===403?'A GitHub App precisa de permissão Contents: Read and write e estar instalada no repositório.':code===404?'Arquivo ou pasta não encontrado, ou GitHub App não instalada nesse repositório.':code===409||code===422?'Conflito: o PDF mudou no repositório. Reabra o arquivo para não sobrescrever alterações.':`Falha do GitHub (HTTP ${code}).`;
    if(code>=500)message='GitHub indisponível temporariamente (HTTP '+code+').';
    throw new HttpError(message+(code===422?' '+String(detail.message||'').slice(0,150):''),code);
  }
  return response;
}
function githubPrefix(env){const c=repoConfig(env);return `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`}
async function metadata(path,session,env){
  const c=repoConfig(env);const r=await github(`${githubPrefix(env)}/contents/${encodePath(path)}?ref=${encodeURIComponent(c.branch)}`,session);
  const meta=await r.json();if(meta.type!=='file'||!/^[0-9a-f]{40}$/i.test(meta.sha||''))throw new HttpError('Arquivo PDF não encontrado.',404);
  return meta;
}
function base64bytes(bytes){
  const chunks=[];const size=12288;
  for(let i=0;i<bytes.length;i+=size){const part=bytes.subarray(i,i+size);let str='';for(let j=0;j<part.length;j++)str+=String.fromCharCode(part[j]);chunks.push(btoa(str))}
  return chunks.join('');
}
function unbase64(s){const raw=atob(String(s).replace(/\s/g,''));return Uint8Array.from(raw,ch=>ch.charCodeAt(0))}
async function pdfRead(path,session,env){
  const meta=await metadata(path,session,env);if(meta.size>MAX_PDF)throw new HttpError('Este PDF ultrapassa 20 MB, o limite desta versão para salvar online.',413);
  const blob=await github(`${githubPrefix(env)}/git/blobs/${meta.sha}`,session);
  let contents;
  if((blob.headers.get('Content-Type')||'').includes('json')){
    const response=await blob.json();if(response.encoding!=='base64')throw new HttpError('Formato do blob PDF não suportado.',502);contents=unbase64(response.content);
  }else{contents=new Uint8Array(await blob.arrayBuffer())}
  if(contents.length>MAX_PDF||contents.length<5||new TextDecoder().decode(contents.subarray(0,5))!=='%PDF-')throw new HttpError('PDF inválido ou maior que 20 MB.',422);
  return new Response(contents,{headers:{'Content-Type':'application/pdf','X-NPS-SHA':meta.sha,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
async function pdfWrite(request,session,env,path){
  if(!session)throw new HttpError('Entre com GitHub antes de salvar.',401);
  noCrossOriginPost(request);
  if(!/^application\/pdf(?:;|$)/i.test(request.headers.get('Content-Type')||''))throw new HttpError('O corpo deve ser um PDF.',415);
  const sha=request.headers.get('X-Expected-Sha')||'';
  if(!/^[0-9a-f]{40}$/i.test(sha))throw new HttpError('Identificador de versão do PDF inválido.',400);
  if(Number(request.headers.get('Content-Length')||0)>MAX_PDF)throw new HttpError('O PDF excede o limite de 20 MB.',413);
  const bytes=new Uint8Array(await request.arrayBuffer());
  if(bytes.length>MAX_PDF)throw new HttpError('O PDF excede o limite de 20 MB.',413);
  if(bytes.length<5||new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw new HttpError('O arquivo exportado não é um PDF válido.',400);
  const info=await metadata(path,session,env);
  if(info.sha!==sha)throw new HttpError('O PDF mudou no GitHub desde que foi aberto. Não sobrescrevemos nenhuma alteração. Reabra o documento atualizado.',409);
  const c=repoConfig(env);
  const data={message:`Atualiza PDF: ${path} (NotaPDF Studio)`,content:base64bytes(bytes),sha,branch:c.branch};
  const response=await github(`${githubPrefix(env)}/contents/${encodePath(path)}`,session,{method:'PUT',body:data});
  const answer=await response.json();if(!/^[0-9a-f]{40}$/i.test(answer?.content?.sha||''))throw new HttpError('GitHub não confirmou o salvamento.',502);
  return result({sha:answer.content.sha,commitSha:answer.commit?.sha||'',path});
}
function secureHeaders(res){
  const r=new Response(res.body,res);
  r.headers.set('Referrer-Policy','no-referrer');r.headers.set('X-Content-Type-Options','nosniff');
  if(!r.headers.has('Content-Security-Policy'))r.headers.set('Content-Security-Policy',"frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  return r;
}
export default {
  async fetch(request,env){
    const url=new URL(request.url),p=url.pathname,method=request.method;
    try {
      if(p==='/auth/login'&&method==='GET'){
        if(!env.GITHUB_APP_CLIENT_ID||!env.GITHUB_APP_CLIENT_SECRET)throw new HttpError('Configure GITHUB_APP_CLIENT_ID e GITHUB_APP_CLIENT_SECRET.',503);
        await secretKey(env);
        const state=random(),verifier=random(),digest=await crypto.subtle.digest('SHA-256',encoder.encode(verifier));
        const authorize=new URL('https://github.com/login/oauth/authorize');
        authorize.search=new URLSearchParams({client_id:env.GITHUB_APP_CLIENT_ID,redirect_uri:url.origin+'/auth/callback',state,scope:'offline_access',code_challenge:to64(new Uint8Array(digest)),code_challenge_method:'S256'}).toString();
        return secureHeaders(redirect(authorize.toString(),[flowCookie(to64(encoder.encode(JSON.stringify({state,verifier}))))]));
      }
      if(p==='/auth/callback'&&method==='GET'){
        const flowValue=cookie(request,FLOW_COOKIE);
        let flow;try{flow=JSON.parse(new TextDecoder().decode(from64(flowValue)))}catch{}
        if(!flow?.state||!url.searchParams.get('state')||!safeEqual(flow.state,url.searchParams.get('state'))||!flow.verifier)throw new HttpError('Validação de login falhou. Volte e clique em Entrar com GitHub.',403);
        const code=url.searchParams.get('code')||'';if(!/^[a-z0-9_\-]{4,300}$/i.test(code))throw new HttpError('Código de autorização inválido.',400);
        const grant=await exchange({code,redirect_uri:url.origin+'/auth/callback',code_verifier:flow.verifier},env);
        const who=await github('/user',{accessToken:grant.access_token});const user=await who.json();
        if(!/^[a-z\d-]{1,39}$/i.test(user.login||''))throw new HttpError('O GitHub não informou o usuário autenticado.',401);
        const encrypted=await seal(sessionFromAuth(grant,user.login),env);
        return secureHeaders(redirect(url.origin+'/',[clearCookie(FLOW_COOKIE),sessionCookie(encrypted)]));
      }
      if(p==='/auth/logout'&&method==='POST'){
        noCrossOriginPost(request);return secureHeaders(appendCookie(result({ok:true}),clearCookie(SESSION_COOKIE)));
      }
      if(p.startsWith('/api/')){
        const auth=await currentSession(request,env),session=auth.session;
        let response;
        if(p==='/api/config'&&method==='GET')response=result(repoConfig(env));
        else if(p==='/api/session'&&method==='GET')response=result({authenticated:!!session,login:session?.login||null});
        else if(p==='/api/tree'&&method==='GET'){
          const path=url.searchParams.get('path')||ROOT;pathParts(path);
          const c=repoConfig(env),r=await github(`${githubPrefix(env)}/contents/${encodePath(path)}?ref=${encodeURIComponent(c.branch)}`,session);
          const rows=await r.json();if(!Array.isArray(rows))throw new HttpError('Este caminho não é uma pasta.',400);
          response=result(rows.filter(v=>v?.type==='dir'||(v?.type==='file'&&/\.pdf$/i.test(v.name||''))).filter(v=>{try{return pathParts(v.path).length>=pathParts(path).length+1}catch{return false}}).map(v=>({name:v.name,type:v.type,path:v.path})).sort((a,b)=>a.type!==b.type?(a.type==='dir'?-1:1):a.name.localeCompare(b.name,'pt-BR',{numeric:true,sensitivity:'base'})));
        }
        else if(p==='/api/pdf'&&method==='GET')response=await pdfRead(pdfPath(url.searchParams.get('path')),session,env);
        else if(p==='/api/pdf'&&method==='PUT')response=await pdfWrite(request,session,env,pdfPath(url.searchParams.get('path')));
        else response=failure('Endpoint não encontrado.',404);
        return secureHeaders(appendCookie(response,auth.setCookie));
      }
      if(p.startsWith('/auth/')||p.startsWith('/api/'))return failure('Não encontrado.',404);
      // Cloudflare serves the entire original editor on the same origin as OAuth/API.
      return secureHeaders(await env.ASSETS.fetch(request));
    }catch(err){
      const status=err instanceof HttpError?err.status:500;
      if(status===500)console.error('Erro no Worker',err?.stack||err);
      return secureHeaders(failure(status===500?'Erro interno do servidor. Confira a configuração e os logs do Worker.':err.message,status));
    }
  }
};
export {pathParts,pdfPath,repoConfig,base64bytes,unseal,seal,safeEqual};
