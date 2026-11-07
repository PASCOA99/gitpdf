# NotaPDF Studio Online 2.0

- Nova implantação mesma origem com Cloudflare Worker + Static Assets, código e PDFs armazenados no GitHub.
- GitHub App login, OAuth com `state`/PKCE, tokens protegidos em cookie criptografado, atualização de sessão.
- Biblioteca de pastas públicas de PDFs, suporte a subpastas, leitura de PDFs com identificação SHA.
- Salvamento do PDF exportado pelo motor original no arquivo original via GitHub REST API; trava de conflito de SHA; sem PAT na interface.
- Removidos campos de configuração/token manual da versão GitHub anterior. Corrigido caminho de fetch que produzia `Illegal invocation`.
- Preservadas as rotinas originais de marcação; mais detalhes no relatório de paridade.
