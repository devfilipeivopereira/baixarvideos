---
name: BaixarHSL - HLS/MPD Video Downloader
description: Web app hospedada no Vercel para baixar streams HLS/MPD privados com autenticação por cookies
type: project
---

# BaixarHSL — Design Spec

## Objetivo

Aplicação web pessoal hospedada no Vercel que permite baixar vídeos HLS (`.m3u8`) e MPEG-DASH (`.mpd`) de sites que exigem autenticação (estilo Vimeo privado, plataformas de cursos, etc.), usando cookies de sessão do navegador do usuário.

## Arquitetura

```
Browser (usuário)
  │
  ├── Next.js Frontend (Vercel)
  │     ├── Formulário: URL da página + cookies de sessão
  │     ├── Progress UI (segmentos baixados)
  │     └── ffmpeg.wasm (montagem client-side → MP4)
  │
  └── API Routes (Vercel Edge Functions)
        ├── POST /api/extract  → scraping + extração da URL do stream
        └── GET  /api/proxy    → proxy CORS autenticado para segmentos
```

## Componentes

### 1. Frontend (`app/page.tsx`)
- Formulário com dois campos: URL da página e textarea para cookies
- Instrução inline sobre como copiar cookies do DevTools
- Barra de progresso de download por segmento
- Botão de download que dispara o fluxo completo
- Estado de erro com mensagem descritiva

### 2. API: `/api/extract`
- Recebe: `{ url, cookies }`
- Faz fetch da página com headers autenticados
- Usa Cheerio para parsear HTML e extrair URLs de stream
- Fallback: regex para encontrar `.m3u8` / `.mpd` no HTML/JS inline
- Retorna: `{ streamUrl, type: 'hls' | 'dash', title }`
- **Limitação documentada**: páginas que carregam a URL do stream via XHR/fetch pós-load (JavaScript assíncrono) não serão detectadas — Cheerio só lê HTML estático. Suporte a páginas JS-rendered (Playwright headless) está fora do escopo v1; nesses casos o usuário deve colar a URL do stream diretamente.
- Timeout de extração: 25s com mensagem de erro clara para o usuário caso a página demore.

### 3. API: `/api/proxy`
- Recebe: POST body `{ url, cookies }` (nunca query string — evita exposição em logs do Vercel e histórico do browser)
- **Nota de segurança**: cookies trafegam no corpo da requisição HTTPS e não são persistidos, mas aparecerão nos logs de acesso do servidor se o Vercel os logar no body. Risco aceitável para uso pessoal.
- Faz fetch do recurso (segmento `.ts`, manifest) com headers autenticados
- Retorna o conteúdo com CORS headers corretos
- Suporta streaming de resposta (Edge Runtime)

### 4. Cliente ffmpeg.wasm
- Usa `@ffmpeg/ffmpeg@0.11.x` (API legada) que opera sem SharedArrayBuffer
- Headers COOP/COEP configurados via `next.config.js` headers() para suporte ao modo multithread quando disponível (funciona no Vercel free tier via Next.js config)
- Recebe lista de segmentos do manifest `.m3u8`
- Baixa todos via `/api/proxy` (POST body, não query string)
- Monta com `ffmpeg -i concat.txt -c copy output.mp4`
- Dispara download do arquivo no browser
- Limitação documentada: vídeos muito longos (>1h) podem ser lentos em modo single-thread

## Stack Técnica

| Camada | Tecnologia |
|--------|-----------|
| Framework | Next.js 14 (App Router) |
| Estilo | Tailwind CSS + shadcn/ui |
| Scraping | Cheerio |
| Proxy | Vercel Edge Functions |
| Processamento | @ffmpeg/ffmpeg (WASM, client-side) |
| Deploy | Vercel (free tier) |

## Fluxo de Uso

1. Usuário abre o site autenticado no browser (ex: plataforma de cursos)
2. Abre DevTools → Application → Cookies → copia todos os cookies do domínio
3. Cola a URL da página do vídeo e os cookies na interface
4. Clica em "Extrair Stream" → app encontra a URL `.m3u8` / `.mpd`
5. Clica em "Baixar" → progresso aparece por segmento
6. Ao finalizar, download automático do `.mp4`

## Limitações e Trade-offs

- **Vercel timeout**: Edge Functions têm limite de 30s; o proxy de segmentos individuais é rápido o suficiente (cada segmento é pequeno)
- **ffmpeg.wasm**: ~30 MB de download no primeiro uso; armazenado em cache depois
- **Credenciais**: cookies nunca são armazenados — trafegam apenas na sessão ativa
- **DRM**: conteúdo com DRM (Widevine/PlayReady) não é suportado e não será implementado

## v2 (fora do escopo v1)

- Suporte completo a MPEG-DASH (`.mpd`) — parsing de XML MPD é substancialmente mais complexo que HLS; v1 foca em HLS com menção de DASH como extensão futura
- Login automatizado (digitar usuário/senha no app)
- Suporte a DRM (Widevine/PlayReady)
- Histórico de downloads
- Suporte a páginas JS-rendered via Playwright headless
- Banco de dados ou autenticação própria
