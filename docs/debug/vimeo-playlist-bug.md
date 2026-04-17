# Debug: Vimeo Segmented Playlist — "Clica em Baixar e baixa um HTML"

**Data:** 2026-04-17  
**Sintoma:** O popup capturava streams corretamente mas não mostrava nenhum vídeo baixável. Quando algo aparecia e o usuário clicava em Baixar, o navegador baixava um arquivo HTML em vez do vídeo.

---

## Evidências Capturadas (console + debug panel)

```
[BaixarHSL] manifesto detectado: https://vod-adaptive-ak.vimeocdn.com/avf/...mp4  (×300+)
[BaixarHSL] stream salvo: vimeo https://skyfire.vimeocdn.com/.../playlist.json?omit=av1-hevc
```

- **300+ linhas de `/avf/*.mp4`** enchendo o storage de fragmentos adaptativos inúteis
- **`playlist.json`** capturada corretamente — mas sem botão de download no popup

---

## Causas Raiz Identificadas

### 1. `/avf/` não estava na lista de fragmentos parciais

`vod-adaptive-ak.vimeocdn.com/avf/segmento.mp4` é um **fragmento adaptativo individual** do stream Vimeo — não é o vídeo completo. Porém nenhum dos filtros reconhecia o padrão `/avf/`.

Resultado: `background.js` chamava `saveStream()` para cada um dos 300+ fragmentos com type `progressive`, lotando o storage e a UI.

**Arquivos afetados (sem `/avf/`):**
- `detector.js` → `isPartialMediaFragmentUrl`
- `interceptor-detector.js` → `isPartialMediaFragmentUrl`  
- `popup-curation.js` → `isPartialFragmentUrl`
- `stream-details.js` → `isPartialFragmentUrl`
- `stream-selection.js` → `isPartialMediaFragmentUrl`
- `background.js` → `detectMediaType` (não tinha filtro nenhum de fragmentos)

### 2. `playlist.json` roteada para o parser errado

O `background.js` tinha um único branch para o tipo `vimeo`:

```js
// ANTES (errado)
if (stream.type === 'vimeo' && self.BaixarHSLDetector) {
  var vimeoText = await fetch(stream.url, ...)
  if (self.BaixarHSLStreamDetails) {
    return self.BaixarHSLStreamDetails.resolveVimeoStreamDetails(vimeoText, stream.url)
    //                                  ^^^^^^^^^^^^^^^^^^^^^^
    // Esse parser espera o JSON do /config (player config), NÃO playlist.json
  }
}
```

O Vimeo expõe **dois formatos completamente diferentes**:

| URL | Formato | Parser correto |
|-----|---------|---------------|
| `player.vimeo.com/video/123/config` | Player config JSON (`request.files.progressive[]`, `request.files.hls`, etc.) | `BaixarHSLStreamDetails.resolveVimeoStreamDetails` |
| `vimeocdn.com/.../playlist.json` | Segmented playlist (`video[]`, `audio[]`, `base_url`, `segments[]`) | `BaixarHSLVimeoPlaylist.resolvePlaylistDetails` |

`resolveVimeoStreamDetails` tentava ler `parsed.request.files.progressive` numa resposta de `playlist.json` — que não tem essa estrutura. Retornava `options: []`, popup não mostrava nada.

### 3. `detectMediaType` classificava `playlist.json` como `'hls'`

```js
// ANTES (errado)
if (/player\.vimeo\.com\/video/i.test(lower)) return 'hls'
if (/vimeo\.com\/video/i.test(lower) && lower.includes('playlist.json')) return 'hls'
```

URLs do tipo `vimeocdn.com/xyz/playlist.json` eram salvas como type `'hls'` no storage. Mas o branch `hls` do `resolveStreamDetails` tenta fazer fetch e parsear como M3U8 — `playlist.json` não é M3U8. O parse falhava ou retornava resultado inútil.

---

## Correções Aplicadas

### Fix 1 — Adicionar `/avf/` a todos os filtros de fragmento parcial

```js
function isPartialMediaFragmentUrl(url) {
  var lower = String(url || '').toLowerCase()
  return (
    lower.includes('/range/') ||
    lower.includes('/segment/') ||
    lower.includes('/avf/') ||   // ← ADICIONADO
    lower.includes('.m4s') ||
    /[?&]range=/.test(lower)
  )
}
```

Aplicado em: `detector.js`, `interceptor-detector.js`, `popup-curation.js`, `stream-details.js`, `stream-selection.js`

Em `background.js`, adicionado na função `detectMediaType` como guard inicial antes de qualquer outra verificação:

```js
if (
  lower.includes('/range/') || lower.includes('/segment/') ||
  lower.includes('/avf/') || lower.includes('.m4s') ||
  /[?&]range=/.test(lower)
) return null
```

### Fix 2 — Rotear `playlist.json` para o parser correto

```js
// DEPOIS (correto)
if (stream.type === 'vimeo') {
  var vimeoText = await fetch(stream.url, ...)

  // playlist.json / master.json → parser de playlist segmentada
  if (
    (urlLower.includes('playlist.json') || urlLower.includes('master.json')) &&
    self.BaixarHSLVimeoPlaylist
  ) {
    var playlistDetails = self.BaixarHSLVimeoPlaylist.resolvePlaylistDetails(vimeoText, stream.url)
    if (playlistDetails && playlistDetails.options.length > 0) {
      return {
        canDownloadVimeoPlaylist: true,
        options: playlistDetails.options,
        selectedType: 'vimeo-playlist',
        selectedUrl: playlistDetails.selectedUrl,
        ...
      }
    }
  }

  // /config → parser de configuração do player Vimeo
  if (self.BaixarHSLStreamDetails) {
    return self.BaixarHSLStreamDetails.resolveVimeoStreamDetails(vimeoText, stream.url)
  }
}
```

### Fix 3 — Corrigir type no `detectMediaType` para URLs Vimeo

```js
// ANTES
if (/player\.vimeo\.com\/video/i.test(lower)) return 'hls'
if (/vimeo\.com\/video/i.test(lower) && lower.includes('playlist.json')) return 'hls'

// DEPOIS
if (/player\.vimeo\.com\/video\/\d+\/config/i.test(lower)) return 'vimeo'
if (lower.includes('vimeocdn.com') && (lower.includes('playlist.json') || lower.includes('master.json'))) return 'vimeo'
if (/skyfire\.vimeocdn\.com|vod-adaptive-ak\.vimeocdn\.com/i.test(lower) && ...) return 'vimeo'
```

---

## Fluxo Correto Após as Correções

```
Vimeo page load
  → webRequest captura: vimeocdn.com/.../playlist.json  (type='vimeo', salvo)
  → webRequest captura: vod-adaptive-ak.vimeocdn.com/avf/seg001.mp4 (filtrado, ignorado)
  → popup abre, chama resolveStreamDetails({type:'vimeo', url:'...playlist.json'})
  → background detecta 'playlist.json', chama BaixarHSLVimeoPlaylist.resolvePlaylistDetails
  → retorna canDownloadVimeoPlaylist:true, options:[{1080p, 720p, ...}]
  → popup renderiza botão "Baixar Vimeo Segmentado"
  → usuário clica → downloadVimeoPlaylistAsMp4 → FFmpeg mux → arquivo .mp4
```
