# NotaPDF Studio 1.9.5 — Biblioteca GitHub

**Objetivo:** usar o mesmo editor de grifos, sublinhados e notas da versão 1.9.5, mas abrir PDFs guardados em pastas/subpastas do GitHub e, ao salvar, **substituir no repositório o PDF original**, preservando nome e localização. Nenhum PDF fica embutido no código JavaScript ou HTML.

## Estrutura pronta

```text
notapdf-studio/
├── index.html
├── app.js                 ← motor de edição 1.9.5, integrado à biblioteca
├── core.js                ← arquivo original INALTERADO
├── styles.css             ← CSS original, acrescido dos estilos da biblioteca
├── github-api.js          ← listar, ler versão exata e sobrescrever arquivo
├── github-library.js      ← navegador de pastas e conexão temporária
├── config.json            ← proprietário, repositório e branch, NUNCA token
├── .nojekyll
├── .gitignore
├── PDFs editáveis/
│   └── Direito administrativo/
│       └── 01 1883 _ 380 - Licitações.pdf  ← exemplo fornecido
├── tests/
│   └── github-api.test.mjs
├── TEST-REPORT-ORIGINAL.md
├── CHANGELOG.md
└── CHANGELOG-ORIGINAL.md
```

**O PDF de exemplo é uma cópia do anexo fornecido e pode ser apagado ou substituído por outros documentos.** O nome dele contém **1883**, não 1833. A ferramenta não conhece nem precisa ser alterada para reconhecer esse PDF: ela consulta a árvore de diretórios do GitHub. Subpastas adicionais são aceitas, e qualquer PDF novo aparece após clicar em **⟳ Atualizar**.

## Implantar pelo GitHub (uma vez)

1. Extraia o ZIP.
2. Crie um **repositório público** em https://github.com/new (por exemplo `notapdf-studio`). **Atenção: qualquer PDF enviado a um repositório público poderá ser acessado por outras pessoas. Não publique documentos confidenciais, pessoais ou restritos.**
3. No repositório, escolha **Add file → Upload files**. Faça upload do **conteúdo extraído** (e não somente do ZIP). Garanta que `index.html` está na raiz e que a pasta `PDFs editáveis` esteja no repositório. O GitHub não conserva pastas vazias: mantenha ao menos um arquivo em cada pasta.
4. Confirme com **Commit changes**.
5. Em **Settings → Pages → Build and deployment**, configure **Deploy from a branch**, selecione a branch `main` e a pasta `/(root)`. Salve.
6. Acesse `https://SEU-USUARIO.github.io/notapdf-studio/` (o endereço oficial aparece em **Settings → Pages**).
7. Na página publicada, a biblioteca detecta automaticamente o proprietário e o repositório quando acessada pelo endereço padrão do GitHub Pages. Se não detectar, clique em **⚙** na biblioteca, informe **Usuário/organização**, **Repositório** e **Branch** (`main`) e depois **Aplicar e navegar**. Essas três preferências são guardadas no navegador; **não contêm credenciais**.

Caso utilize domínio personalizado ou branch diferente, use o botão **⚙**. Você também pode inserir owner/repo/branch em `config.json`; não coloque nenhum token lá.

## Rotina diária (sem download)

1. No próprio GitHub, entre na pasta `PDFs editáveis` (ou qualquer subpasta) e use **Add file → Upload files** para incluir PDFs novos. Você pode criar subpastas normalmente pela interface do repositório. **Nenhuma alteração no código é necessária.**
2. Abra a ferramenta publicada. Clique em **⟳** para atualizar a lista. Expanda as pastas por **📁** e selecione um **📄 PDF**.
3. O PDF abre no editor exatamente como se fosse selecionado no computador: grifos, destaques sólidos, sublinhados, cores, opacidade, notas editáveis, imagens, histórico, zoom, navegação e atalhos continuam no motor 1.9.5.
4. Edite e clique em **⇧ Salvar no GitHub** (ou `Ctrl+S` / `⌘S`). Na primeira vez em que salvar após abrir a página, será necessário informar um **token pessoal de acesso** com permissão restrita de gravação no repositório.
5. O aplicativo exporta e valida o PDF usando **o motor original**, compara o SHA do arquivo aberto com o SHA atual no GitHub e faz um commit substituindo **exatamente o mesmo caminho e nome**. O arquivo anterior fica recuperável no histórico do GitHub. Ao abrir novamente o PDF na biblioteca, você verá a versão atualizada.

O botão **↓ Baixar cópia** é opcional. O botão **↥ Abrir PDF local** continua permitindo trabalhar com arquivos do computador sem transferi-los ao GitHub: nesse modo, **Salvar PDF** mantém o download original.

## Como obter o token apenas para gravar (uma vez até expirar)

No GitHub, abra **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**. Configure:

- **Resource owner:** o dono do repositório.
- **Repository access:** **Only select repositories**, selecionando apenas o repositório desta ferramenta.
- **Repository permissions → Contents:** **Read and write**.
- **Expiration:** use um prazo curto conforme sua necessidade.

Crie o token, copie-o e cole no campo **🔑** da ferramenta. A visualização de pastas de repositórios públicos geralmente funciona sem token; o token é obrigatório para sobrescrever um arquivo. Em organizações com políticas de aprovação, pode ser necessário autorizar o token.

**Segurança:** o token fica apenas na memória da aba e não é colocado em `config.json`, no GitHub Pages, no código, em URLs, nem em `localStorage`. Ao fechar ou atualizar a página, deve ser inserido novamente para salvar. Clique em **Esquecer token desta aba** para descartá-lo antes. Nunca envie o token junto aos PDFs nem publique prints que o revelem. O aplicativo, como o original, carrega PDF.js, pdf-lib e html2canvas de um CDN público; não utilize tokens de acesso irrestrito e evite documentos sensíveis em páginas públicas.

## Regras importantes do salvamento

- O salvamento automático **não é possível** com GitHub Pages sozinho, porque Pages oferece hospedagem estática. O mecanismo novo usa a **API REST de conteúdo do GitHub** diretamente no navegador, autenticada com o token informado por você.
- **Sobrescrita segura:** se o PDF for alterado no repositório depois que você o abriu, o aplicativo **recusa a gravação** e pede para reabrir a versão mais recente. Ele não tenta mesclar dois PDFs conflitantes. Isso impede a perda silenciosa do trabalho feito em outra sessão.
- Ao salvar, o aplicativo **não depende do GitHub Pages republicar imediatamente**. A biblioteca lê diretamente a API do repositório e consulta o blob imutável pelo SHA.
- O GitHub fornece histórico de commits: é possível restaurar a versão anterior manualmente pelo próprio GitHub.
- O limite técnico de conteúdo do GitHub para os endpoints utilizados é **100 MB por arquivo**. PDFs grandes podem consumir muita RAM do navegador durante exportação e conversão para Base64; arquivos de tamanho moderado são recomendados. O endpoint que lista uma única pasta tem limite de **1.000 entradas**.
- PDFs assinados/criptografados e páginas rotacionadas continuam sujeitos às **mesmas restrições do exportador original**. Este pacote não contorna tais proteções.
- **PDFs públicos são públicos:** não confunda o token de gravação com privacidade dos arquivos de um repositório público. Para uso com PDFs privados, seria preferível uma solução hospedada com autenticação e controle de acesso.
- Os arquivos `TEST-REPORT-ORIGINAL.md` e `CHANGELOG-ORIGINAL.md` preservam os registros recebidos, incluindo limitações dos testes originais. Eles não são provas de testes da integração GitHub.

## Verificação e limitações

O arquivo `core.js` foi copiado **byte a byte**. O motor de notas, seleção e exportação continua em `app.js`; alterações pontuais incluem origem do arquivo, destino do salvamento, proteção contra perda de alterações locais e botões de interface. O código adicional de acesso ao repositório está isolado em `github-api.js` e `github-library.js`.

Executar testes automatizados de API e conversão binária:

```bash
node --check app.js
node --check core.js
node --check github-api.js
node --check github-library.js
node --test tests/github-api.test.mjs
# Opcional: precisa de Python com Playwright + Chromium
python tests/browser_github_smoke.py
```

O teste de navegador usa o HTML/JS reais, mas **simula o GitHub, o PDF.js e o pdf-lib**; não é um teste da exportação PDF real.

**Limite da validação:** a suíte automatizada verifica operações da integração em cenários simulados de API, incluindo SHA conflitante. Não houve teste de gravação real em um repositório do usuário, nem validação de ponta a ponta do PDF gerado com as dependências externas reais, nem validação física em Safari/Acrobat. Verifique primeiro em um repositório de teste com uma cópia do PDF. Não é possível garantir identidade absoluta de comportamento em todos os PDFs sem esses ensaios.

## Referências oficiais

- Leitura de diretórios e arquivos: https://docs.github.com/en/rest/repos/contents
- Substituir arquivo, informando `sha`: https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents
- Leitura do blob por SHA: https://docs.github.com/en/rest/git/blobs#get-a-blob
- Publicar o site: https://docs.github.com/en/pages/quickstart
