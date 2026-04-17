# BaixarHSL - Extensao Chrome

Extensao para capturar videos incorporados em paginas e baixar direto para o PC, inclusive convertendo HLS nao protegido por DRM para `.mp4`.

## Instalacao

1. Abra `chrome://extensions`
2. Ative `Modo de desenvolvedor`
3. Clique em `Carregar sem compactacao`
4. Selecione esta pasta

## Fluxo de uso

1. Abra a pagina com o video
2. Clique em `Atualizar` no popup da extensao
3. Escolha a resolucao disponivel
4. Clique em `Baixar no PC`

## O que aparece no popup

- miniatura do video
- titulo detectado
- lista de resolucoes disponiveis
- botao de download direto
- capturas recentes da aba atual
- classificacao explicita entre fluxo baixavel, detectado e `DRM/protegido`
- painel de debug para diagnostico

## Observacoes

- videos Vimeo privados incorporados continuam sendo um foco principal desta extensao
- a extensao tambem tenta detectar arquivos diretos como `mp4`, `webm`, `mov` e players baseados em `MediaSource`
- quando o player expuser HLS sem DRM, a extensao baixa os segmentos e converte para `.mp4` localmente
- DASH ainda e apenas detectado nesta versao
- durante uma conversao HLS, mantenha o popup aberto ate o download ser iniciado
- quando houver DRM, a extensao informa que o conteudo esta protegido em vez de falhar silenciosamente
