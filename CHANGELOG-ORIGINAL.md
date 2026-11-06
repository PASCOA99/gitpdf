# Histórico de alterações — NotaPDF Studio

## 1.9.5 — 03/11/2026 — barra rápida opcional e duplo clique

- Removidos da interface os seletores independentes de cor sólida e os botões avulsos de destaque sólido da barra normal e do menu de tela cheia, mantendo intacto o motor `applyMark('solid', ...)`. As cores primária/secundária e a checkbox C/V sólido continuam comandando os destaques sólidos.
- Adicionada a checkbox **Barra rápida** ao lado de **C/V sólido**, desmarcada por padrão. Os controles normal e de tela cheia compartilham o mesmo estado, e desativar oculta imediatamente a barra flutuante.
- A barra rápida agora é exibida também após duplo clique sobre uma palavra, quando habilitada, utilizando `selectPdfWordAtPoint()` e as coordenadas já compartilhadas com os grifos.
- Arraste com o mouse e seleção nativa continuam funcionando quando a checkbox está habilitada; seleção normal não abre a barra quando está desabilitada.
- Mantidos sem alterações: `core.js`, algoritmos de geometria e marcação, opacidade dos grifos comuns, notas, atalhos C/V/B, histórico e exportação PDF.
- Testes de regressão de interface/teclado no Chromium passaram com bibliotecas PDF simuladas; a exportação real continua sem teste de ponta a ponta.

---

## 1.9.4 — 03/11/2026 — correção da exibição da barra rápida

- Corrigida a referência de CSS desatualizada no `index.html` da 1.9.3 (`styles.css?v=1.9.2`), que podia recuperar um arquivo em cache sem os estilos de posicionamento fixo da barra rápida. JavaScript e CSS usam uma chave de cache nova.
- O reconhecimento de arraste agora possui um observador independente em fase de captura sobre a camada textual, preservando os handlers atuais de seleção. Assim, mostra a barra para seleção válida feita pelo mouse mesmo quando a captura de texto customizada não registra o arraste.
- Seleção customizada exibe imediatamente no `pointerup`; seleção nativa pode ser confirmada no próximo quadro, depois do `mouseup`. Clique simples não abre a barra.
- Foram testados no Chromium o caminho customizado e a seleção nativa do navegador, o clique no botão central, posicionamento em coordenadas de viewport, modo sólido, fullscreen, notas e atalhos.
- `core.js` e `styles.css` idênticos ao pacote 1.9.3. Sem modificação dos algoritmos de grifo, destaque sólido, sublinhado, formatação, exportação e compactação.
- Os testes não executam a exportação ponta a ponta com PDF.js/pdf-lib reais nem um MacBook físico; versão permanece beta técnica.

---

## 1.9.3 — 03/11/2026 — barra rápida após seleção com mouse

- Adicionada uma barra flutuante **exclusivamente com três botões de ação**, visível somente depois de arrastar com o botão esquerdo e soltar sobre uma seleção válida da camada de texto do PDF.
- As ações, da esquerda para a direita: **grifo primário (Alt/Option+C)**, **grifo secundário (Alt/Option+V)** e **sublinhado (Alt/Option+B)**. O botão do meio fica centralizado horizontalmente sobre a posição do mouse na soltura, exceto ao encontrar as margens da janela.
- A barra aparece imediatamente acima da posição de soltura (9 px de afastamento). Próximo da borda superior, é deslocada para baixo para permanecer acessível. Funciona também em modo tela cheia.
- **Sem controles de edição de cor**: os botões leem as cores já configuradas; os dois grifos usam a checkbox C/V sólido e o controle de opacidade exatamente como os atalhos correspondentes. O sublinhado continua independente.
- O clique na barra preserva a seleção até a operação; a barra desaparece após aplicar a ação, clicar fora, começar outra seleção, mudar de página, rolar, redimensionar, abrir o editor, alternar a seleção, entrar/sair de tela cheia ou pressionar Esc.
- Reutiliza `applyColorSlot()` e `applyMark()` existentes, sem alterar a geometria, o formato das marcações, o exportador, a estrutura de notas ou `core.js`.
- Teste Chromium com arraste real do mouse, posição e centralização, clique nos três botões, modo comum/sólido, desfazer estado e condições de fechamento, também em tela cheia e janela estreita. Regressões anteriores repetidas.
- A exportação ponta a ponta com PDF.js/pdf-lib reais e o funcionamento no Safari/MacBook físico não foram validados nesta sessão.

---

## Ajuste exclusivo de atalhos — base 1.9.2 mantida

- Alt/Option+C: grifo primário; Alt/Option+V: grifo secundário; Alt/Option+B: sublinhado.
- Checkbox de grifo sólido continua sobre os dois grifos (agora C/V).
- Apenas roteamento de teclas, descrições na interface, testes e documentação; sem mudanças nos algoritmos de grifo, seleção, notas ou exportação.

## 1.9.2 — 03/11/2026 — geometria de texto justificado

- **Correção restrita à seleção e ao posicionamento dos grifos:** leitura da lista de operadores do PDF.js (`getOperatorList`) para obter os avanços reais dos glifos. Considera deslocamentos `TJ`, espaçamentos de palavra/caractere, escala horizontal, matrizes de texto e transformações gráficas. Suporta casos com comandos `BT`/`Tm`/`Td` separados, comuns em PDFs produzidos a partir de editores de texto.
- Os limites calculados por caractere passam a alimentar o mesmo motor já usado pelo cursor, pela faixa visual de seleção, pelos grifos comuns, pelos grifos sólidos e pelos sublinhados. Evita dividir a largura total de uma linha pela métrica de uma fonte substituta do navegador.
- Validação de consistência: os caracteres só usam a geometria detalhada quando coincidem com o conteúdo extraído e os limites efetivos do item no PDF. Se não houver dados suficientes, mantém o método anterior; não inventa posições.
- Cache limitado às cinco últimas páginas para não recalcular os glifos a cada alteração de zoom.
- **Sem alterações** na compressão, na exportação de PDF, nos atalhos Alt/Option, no seletor de destaque sólido, na opacidade, nas cores, nos pop-ups, nas notas ou no CSS.
- Testes de funções puras com deslocamentos de texto justificado e posicionamento independente de glifos, além de teste de navegador com fonte deliberadamente diferente da usada no PDF. Testes de regressão 1.9.1 reexecutados.
- Limitação: não foi possível executar o PDF.js real baixado do CDN nesta sessão. Os testes de navegador usam substitutos de bibliotecas externas; a validação final com PDF.js real, Acrobat e documentos de fontes rotacionadas/complexas ainda requer teste prático.

---


## 1.9.1 — 03/11/2026 — checkbox para Alt/Option+V/B alternar entre grifo comum e destaque sólido

- Nova checkbox **V/B sólido** na barra de marcação, espelhada por **V/B: destaque sólido** no menu de tela cheia; as duas permanecem sincronizadas.
- **Desmarcada por padrão:** Alt/Option+V/B e os botões de grifo primário/secundário aplicam o grifo **comum** com a opacidade selecionada (padrão 42%).
- **Marcada:** os mesmos atalhos e botões aplicam o **destaque sólido** (100%), sem consultar nem alterar o controle de opacidade; cada tecla usa a cor atualmente selecionada em seu próprio seletor (V = primário; B = secundário).
- A mudança de checkbox afeta apenas as **próximas marcações**, sem modificar grifos anteriores. Desmarcar restaura o comportamento tradicional imediatamente.
- Alt/Option+N (sublinhado) e o botão **▰ Sólido** independente, com seu seletor próprio, continuam intactos. A opção começa desmarcada a cada abertura do aplicativo e não modifica dados de notas ou formato PDF.
- Roteamento centralizado em `applyColorSlot()` para evitar divergência entre teclado, botões normais e modo tela cheia.
- Teste de integração no Chromium: cliques reais, Alt+V, Alt+B, Option+B simulado com tecla física KeyB, cores independentes, opacidade isolada, sincronização em tela cheia e retorno ao modo comum. Todos os testes anteriores da versão 1.9.0 foram reexecutados.
- **Limitações herdadas:** não há validação de exportação ponta a ponta com `pdf-lib` real do CDN, nem teste em MacBook físico/Safari/Acrobat. A técnica do destaque sólido rasterizado mantém as mesmas limitações em fundos complexos.

## 1.9.0 — 03/11/2026 — modo independente Destaque sólido

- Novo botão **▰ Sólido** e seletor de cor dedicado no topo e no modo tela cheia; não muda as cores dos grifos comuns nem o slider de opacidade.
- Realce sólido em PDF com fundo cinza e branco: o aplicativo gera apenas o recorte selecionado em cor integral, recompondo a tinta escura dos glifos visíveis sobre essa cor. Conteúdo original PDF e texto extraível continuam preservados sob a aparência sobreposta.
- Marcadores sólidos separados por `type:'solid'`, com cor própria e suporte a desfazer/refazer; exportação com imagens pontuais em alta resolução e inserção por `page.drawImage` antes das marcas Multiply habituais.
- Testes de navegador com módulos reais, bibliotecas PDF simuladas: criação/edição de notas, navegação, paletas, opacidade independente, aparência dos destaques sólidos, histórico e chamada de exportação de imagens.
- Teste adicional usando a função JavaScript real sobre o PDF cinza fornecido, montagem temporária de PDF com PyMuPDF, conferência de amarelo e magenta intensos, texto selecionável e anotações mantidas.
- **Limites:** o recorte é rasterizado; desenhos complexos, textos claros, fundos muito escuros ou imagens podem ficar diferentes da origem. Exportação final por pdf-lib e validação Acrobat ainda dependem de teste manual.

## 1.8.0 — 03/11/2026 — reconstrução a partir da última versão funcional

- Código-fonte reconstruído sobre os arquivos da versão **1.6.0 fornecidos pelo usuário**, sem reaproveitar o código da 1.7.0 que apresentou regressões.
- Controle de opacidade (10%–100%, padrão 42%), prévia sobre cinza, sincronização da barra principal com a tela cheia, opacidade individual persistida para cada novo grifo e múltiplos `/ExtGState` com `/ca` variável no PDF exportado.
- Corrigido o CSS legado `opacity: .42 !important` que anulava a alteração de opacidade na prévia.
- Navegação por teclas ←/→, inclusive tela cheia, sem interferência em inputs, controles deslizantes ou janela de edição.
- Posicionamento de notas com instrução visual explícita; botão Nova nota e fluxo de criação, salvamento e reabertura testados com cliques reais.
- Paleta Word-like com 20 cores para texto/marca-texto, botão principal para repetir a última cor e seletor avançado; popovers fora da área recortada pelo scroll do editor.
- Espaçamento entre linhas e após parágrafo aplicado a conteúdo com margens/entrelinhas inline; histórico e formatação salvos nos metadados existentes.
- URL versionada para CSS/JS no HTML, prevenindo cache de arquivos da versão anterior.
- Regressão com ESM real no Chromium (PDF.js/pdf-lib simulados), fluxo completo de nota na interface, testes de pixels do grifo em fundo cinza, validação dos operadores de PDF e testes independentes no PDF de exemplo real.
- **Limite conhecido:** não foi possível executar PDF.js, pdf-lib e html2canvas reais, devido ao ambiente sem acesso aos CDNs. Não é validação ponta a ponta de exportação, nem teste em MacBook ou Adobe Acrobat.

## 1.6.0 — 02/11/2026

### Seleção de texto em fontes como Palatino Linotype
- A seleção deixa de pintar uma segunda cópia dos caracteres usando uma fonte do navegador. O texto real do PDF segue visível no canvas; apenas uma faixa azul-clara independente indica a seleção.
- Coordenadas das palavras, da faixa e dos novos grifos ficam ancoradas no início e na largura reais dos itens `TextContent` do PDF.js quando disponíveis; trechos parciais são proporcionais dentro de cada item. Fontes indisponíveis e textos rotacionados conservam um fallback.
- Aguarda `document.fonts.ready` antes de reconstruir a geometria, reduzindo erros por carregamento tardio das fontes incorporadas.

### Marcação sobre fundos cinza e coloridos
- O grifo permanente passa a ser acrescentado ao fim da lista `/Contents`, usando `/BM /Multiply` e `/ca 0.42` sobre o conteúdo original, em vez de ser desenhado antes dele. Assim, o fundo opaco da página não apaga a marcação.
- Os fluxos de conteúdo originais são protegidos com `q`/`Q`, e o texto original permanece selecionável. O sublinhado também fica acima do fundo.
- Teste gráfico independente com o PDF de 10 páginas fornecido: ordem antiga resultou em cor invisível; ordem nova produziu alteração visível de cor sem clarear os pixels escuros do texto.
- Funcionalidades das versões anteriores preservadas; versão permanece beta e exportação ponta a ponta com pdf-lib/Acrobat ainda não foi comprovada.

## 1.5.0 — 01/11/2026

### Edição de notas
- Novos controles de espaçamento entre linhas (1,0 / 1,15 / 1,5 / 2,0) e após parágrafos (0 / 4 / 8 px).
- Notas novas iniciam com espaçamento simples e sem espaço após parágrafos; notas antigas preservam o espaçamento anterior, caso ainda não possuam preferências próprias.
- Preferências de espaçamento persistem em `NPSData` e são usadas no editor, na prévia e no raster da exportação PDF.
- Texto não formatado em preto sobre fundo branco no editor, inclusive com tema escuro; cores intencionais no HTML permanecem preservadas.

### Navegação e atalhos
- Campo de página passa a selecionar seus dígitos ao clicar/receber foco e aceita Enter para navegar diretamente.
- Botões laterais de página anterior/seguinte no modo tela cheia, com limites refletidos no estado desativado.
- Atalhos Alt/Option+V/B/N passam a verificar `KeyboardEvent.code` para reconhecer teclados macOS com símbolos ou teclas mortas.
- Atalhos do PDF não interferem na digitação do editor de notas.

### Testes e limites
- Novas verificações Node e teste Chromium de interface com bibliotecas PDF simuladas e eventos Option simulados.
- Os sete arquivos enviados foram preservados como base. Os arquivos antigos da pasta de testes não foram fornecidos nesta revisão; exportação PDF real e Adobe Acrobat continuam sem validação end-to-end.

## 1.4.0 — 31/10/2026

### Seleção textual
- Reconstrução de separadores visuais entre spans da TextLayer, com espaço na mesma linha e quebra de linha quando muda a linha de base.
- Segmentação de palavras por `Intl.Segmenter` e medição de retângulos com `Range.getClientRects()`.
- Hit-test prioriza a linha visual mais próxima; impede selecionar a primeira palavra da linha inferior enquanto o ponteiro ainda está na linha superior.
- Ao cruzar da primeira para a segunda palavra, a âncora passa ao início da primeira palavra, mantendo-a integralmente selecionada.
- Ao recuar dentro da palavra ativa, retorna à seleção por caracteres; ao avançar, a palavra volta a ser completada.
- Duplo clique seleciona somente a palavra, sem pontuação ou espaço posterior.

### Grifos
- Prévia visual ajustada para 42% de opacidade e modo Multiply.
- Exportação PDF usa preenchimento `/ca 0.42` e traço `/CA 1`.
- Teste de PDF real compara pixels escuros dos caracteres antes/depois do grifo, além de verificar extração de texto e posição do sublinhado.

### Testes
- Testes Node de funções de dados.
- Testes de interface Chromium com PDF.js/pdf-lib simulados.
- Teste independente de fluxo PDF real com PyMuPDF e pypdf.

### Limitações
- O teste de interface usa stubs das bibliotecas externas; não valida o exportador pdf-lib real.
- O teste de fluxo PDF comprova a ordem de desenho vetorial e preservação de pixels do texto, mas não substitui validação no Adobe Acrobat.
- Continua sendo uma versão beta técnica.

## 1.3.0
- Grifos vetoriais inseridos antes dos fluxos originais.
- Ajustes de seleção textual, cursor e sublinhado.

## 1.2.0
- Correção da camada TextLayer, modo escuro inicial, atalhos e menu de tela cheia.

## 1.1.0
- Rolagem interna de notas, fontes menores, imagens coladas, grifos e sublinhados permanentes.
