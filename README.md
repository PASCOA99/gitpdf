# NotaPDF Studio Online — GitHub App + Cloudflare Worker

**Projeto pronto para configuração e publicação; não é um site previamente ativado.** O editor e o serviço de nuvem são entregues juntos em um ZIP. Após a configuração inicial, o usuário abre o site de qualquer lugar, entra com GitHub e edita/salva PDFs na **mesma pasta do repositório**, sem downloads, sem pastas locais e **sem tokens pessoais**.

> A gravação no GitHub sempre precisa de **autorização**. Aqui ela é feita com login do GitHub através de uma **GitHub App**, com permissão restrita ao(s) repositório(s) selecionado(s). O cliente da ferramenta não exibe nem recebe tokens do GitHub. O serviço Cloudflare recebe e protege as credenciais de sessão.

## Estrutura

```text
NotaPDF-Studio-Online-GitHub-App/
├── public/                         Interface publicada na Cloudflare
│   ├── index.html
│   ├── styles.css
│   ├── app.js                     Editor original com integração de salvamento
│   ├── core.js                    IDÊNTICO ao original 1.9.5
│   ├── github-api.js              Chamadas apenas ao Worker do mesmo domínio
│   ├── github-library.js          Pastas e salvamento
│   └── gerar-chave.html           Gerador de chave de sessão no navegador
├── src/worker.js                   GitHub OAuth, leitura, controle de versão, gravação
├── PDFs editáveis/
│   └── Direito administrativo/
│       └── 01 1883 _ 380 - Licitações.pdf   Exemplo, não incorporado ao código
├── wrangler.jsonc                  Configuração da implantação
├── package.json                   Testes e comando opcional de implantação
├── tests/                          Testes automatizados
├── README.md
├── PARIDADE-E-TESTES.md
└── .gitignore
```

## Implantação online, sem instalar software para usar

**Passo 1 — Repositório GitHub:** crie ou use um repositório GitHub **público**. Extraia o ZIP e envie os arquivos e pastas para a raiz (não envie apenas o ZIP). O nome e as subpastas em `PDFs editáveis` podem ser alterados e ampliados depois. Mantenha a pasta raiz exatamente como `PDFs editáveis`. Faça o commit.

**Passo 2 — Ajuste a configuração:** no GitHub, edite `wrangler.jsonc` e substitua:

- `GITHUB_OWNER`: seu usuário/organização que possui os PDFs;
- `GITHUB_REPO`: o nome do repositório contendo a pasta `PDFs editáveis`;
- `GITHUB_BRANCH`: a branch na qual os arquivos são mantidos (`main`, por exemplo);
- `GITHUB_APP_SLUG`: o identificador público da GitHub App que será criada no próximo passo (pode ser preenchido depois).

Esses valores **não são segredos**; as credenciais da GitHub App nunca devem ser escritas nesse arquivo.

**Passo 3 — Publicar o Cloudflare Worker com o site:** acesse [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** e crie um Worker conectado ao repositório GitHub (Git integration). Configure o deploy do código pelo Wrangler (`npx wrangler deploy`) ou use Wrangler na sua máquina somente se preferir. `wrangler.jsonc` usa `main: ./src/worker.js` e `assets.directory: ./public`; o Worker hospeda **tanto a interface quanto a API no mesmo domínio**. Após o deploy, copie o endereço gerado, por exemplo `https://notapdf-studio-online.SEUSUBDOMINIO.workers.dev`.

**Importante:** **não habilite GitHub Pages como endereço principal deste projeto**. O site e a API devem usar o mesmo domínio da Cloudflare para os cookies seguros de login funcionarem também em navegadores que bloqueiam cookies de terceiros. Todo o **código-fonte e todos os PDFs continuam hospedados no GitHub**; só a execução da interface e da API fica na Cloudflare. Seu computador não armazena biblioteca, alterações nem PDFs para o fluxo principal.

**Passo 4 — Criar a GitHub App:** em [GitHub Developer Settings → GitHub Apps](https://github.com/settings/apps), crie **New GitHub App** e configure:

- **GitHub App name:** escolha um nome exclusivo, como `seuusuario-notapdf-studio`;
- **Homepage URL:** o endereço `https://...workers.dev` do passo 3;
- **Callback URL:** `https://...workers.dev/auth/callback` (com domínio exatamente igual ao endereço final);
- **Repository permissions → Contents:** `Read & write`;
- **Webhooks:** desative **Active** (a aplicação não usa webhooks);
- **Where can this GitHub App be installed?** `Only on this account` é adequado para uso individual;
- **Request user authorization (OAuth) during installation:** deixe desativado se disponível; a ferramenta inicia a autorização pelo botão **Entrar com GitHub**.

Salve a GitHub App e copie seu **Client ID** (não confundir com o App ID). Gere um **Client secret** na página da App. Instale a GitHub App pelo menu **Install App** e selecione **Only select repositories**, escolhendo apenas o repositório com os PDFs. Você precisará conceder permissão de conteúdo somente a esse repositório. O projeto **não pede chave privada da GitHub App**: utiliza tokens de usuário com permissões limitadas à App e ao usuário.

**Passo 5 — Configurar três secrets na Cloudflare:** na página do Worker, abra **Settings → Variables and Secrets** e adicione como **Secrets**, nunca como variáveis públicas:

| Nome | Valor |
|---|---|
| `GITHUB_APP_CLIENT_ID` | o Client ID da App |
| `GITHUB_APP_CLIENT_SECRET` | o Client secret criado no GitHub |
| `SESSION_KEY` | chave aleatória de 32 bytes codificada em Base64 |

Você pode gerar a `SESSION_KEY` no navegador em `https://SEU-WORKER.workers.dev/gerar-chave.html`. A chave é gerada pelo navegador e precisa ser copiada **uma única vez** ao painel de secrets. **Não envie a chave para o GitHub**, não a inclua em `wrangler.jsonc`, e não a compartilhe. Após adicionar secrets, atualize/implante o Worker se o painel solicitar.

**Passo 6 — Usar:** abra o endereço do Worker, faça login em **Entrar com GitHub** e utilize a árvore de `PDFs editáveis`. Clique no PDF, faça as marcações e escolha **Salvar no GitHub**. Abra de outro computador/celular, faça login com seu GitHub se necessário, e os arquivos atualizados estarão lá. Ao adicionar novo PDF no GitHub, clique **⟳** na biblioteca.

### Rotina de edição

1. Adicionar arquivo no repositório, dentro de `PDFs editáveis/Qualquer subpasta/...`.
2. Abrir o site publicado e clicar em **⟳**. Expandir as subpastas; selecionar o PDF.
3. Fazer grifos normais ou sólidos, sublinhados, notas pop-up etc.
4. Clicar **Salvar no GitHub**. A API valida o PDF exportado e usa o SHA do arquivo lido para substituí-lo no **mesmo caminho e nome**.
5. Se alguém alterar o PDF entre a abertura e o salvamento, a ferramenta **não sobrescreve** sem aviso. Nesse caso, reabra a versão mais recente e reaplique alterações não salvas.
6. Se quiser, **Baixar cópia** continua opcional, mas não é necessário para salvar no repositório.

## Limites e segurança

- O GitHub App login **não pede token pessoal ao usuário**. Tokens de acesso e renovação são guardados **criptografados** dentro de um cookie `Secure`, `HttpOnly`, `SameSite=Lax`; são utilizados pelo Worker. O token não fica no JavaScript de edição, `localStorage`, URLs nem no repositório.
- Login é de GitHub App (`user-to-server OAuth`), com `state` e `PKCE S256`. A permissão é a interseção das permissões da App, do repositório instalado e da sua conta. O usuário pode revogar o acesso no GitHub.
- O Worker restringe leitura e gravação à pasta `PDFs editáveis` e restringe escrita a `.pdf`. Há proteção de origem/CSRF e verificação do SHA antes de sobrescrever.
- PDFs do repositório público são públicos. Não envie material privado por engano.
- **Limite de 20 MB por PDF** nesta configuração de Worker. O tamanho foi limitado deliberadamente para evitar falhas de memória e de payload em requisições grandes; não significa que o editor original não aceite arquivos maiores. Arquivos grandes poderão exigir outra arquitetura de armazenamento/transporte.
- Não há banco de dados nem arquivos locais para a biblioteca. O histórico do GitHub registra cada atualização; o código do editor continua baseado na versão 1.9.5.
- As bibliotecas PDF.js, pdf-lib e html2canvas são buscadas por CDN; a página precisa de internet.
- A interface de login e o endereço do site estão na Cloudflare, **não no GitHub Pages**. O repositório GitHub continua sendo o armazenamento de código e documentos.
- O cookie persistente expira após 150 dias ou antes se as credenciais do GitHub expirarem/forem revogadas; nesse caso, basta fazer **Entrar com GitHub** novamente. Não é preciso gerar PAT.

## Testes locais opcionais para desenvolvedores

```sh
npm install
npm run check
npm test
python tests/browser_online_smoke.py
```

O teste de navegador depende de Playwright + Chromium e utiliza **PDF.js e pdf-lib simulados**. Veja `PARIDADE-E-TESTES.md` para o que foi e não foi validado. **É indispensável testar o primeiro salvamento real com uma cópia de um PDF**, em um repositório controlado, antes de confiar em documentos importantes.

## Documentação oficial

- [GitHub App — token do usuário e PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub API — substituição de arquivo e SHA](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)
- [Cloudflare Workers — Assets](https://developers.cloudflare.com/workers/static-assets/binding/)
