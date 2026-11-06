# Changelog — integração com GitHub (sobre a versão original 1.9.5)

- Nova navegação dinâmica e recursiva sob `PDFs editáveis`, com subpastas e nomes acentuados.
- Abertura de PDF de qualquer pasta através de SHA e API do GitHub, sem embed de documentos no código.
- Salvar no mesmo caminho e nome, usando o exportador PDF preexistente e a API `PUT /contents`.
- Controle de concorrência por SHA; autorização temporária com token fino em memória; sem armazenar credenciais em arquivos públicos.
- Abertura e download locais originais permanecem disponíveis; botão separado **Baixar cópia**.
- Confirmação antes de descartar notas e marcações ainda não salvas.
- `core.js` mantido idêntico ao original; estrutura do motor de grifos, notas, PDF.js e pdf-lib mantida.
- Testes de API e codificação incluídos. A validação com GitHub real/PDFs reais no navegador publicado ainda não foi realizada.
