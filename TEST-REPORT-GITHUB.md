# Relatório de verificação da integração GitHub

## Escopo

- `node --check` em `app.js`, `core.js`, `github-api.js`, `github-library.js`: **PASSOU**.
- `node --test tests/github-api.test.mjs`: **6 testes PASSARAM** — caminhos com acentos/espaços, Base64 binário, navegação por pasta, SHA de arquivo, gravação no mesmo caminho, recusa por versão alterada, erros de autenticação e leitura por blob.
- `python tests/browser_github_smoke.py`: **PASSOU** — HTML e JS do projeto em Chromium com serviços PDF e GitHub simulados; abertura da subpasta, seleção do PDF de amostra, botão Salvar no GitHub, token temporário, PUT no mesmo caminho e bloqueio de conflito de SHA. O teste não executa a exportação real do PDF; as bibliotecas PDF.js e pdf-lib são simuladas.
- Identidade byte a byte de `core.js` e o anexo `core(4).js`: **CONFIRMADA** (SHA-256 `b754ce49e528d8bb76beaad15928f5b2f8067ce92e2ee147cd180189b89d2fa1`).
- PDF de exemplo: cópia sem modificações do arquivo original enviado.

## Limitações (importantes)

Não foi possível conectar a um repositório real do GitHub, usar um token verdadeiro do usuário ou executar um fluxo de exportação ponta a ponta com as bibliotecas PDF.js/pdf-lib reais nesse ambiente. Não foi feita validação física no Safari, no Adobe Acrobat nem em PDFs variados. O resultado não é uma garantia absoluta de paridade funcional com a versão original em todos os casos. Faça primeiro um teste num repositório de ensaio, preferencialmente com uma cópia do PDF.

O arquivo `TEST-REPORT-ORIGINAL.md` é histórico e não certifica esta integração.
