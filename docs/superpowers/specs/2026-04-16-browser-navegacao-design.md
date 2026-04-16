---
name: BaixarHSL — Navegação Autenticada com Puppeteer
description: Adiciona painel de navegação headless para sites autenticados e captura automática de stream .m3u8
type: project
---

# Navegação Autenticada + Captura Automática de Stream — Design Spec

## Objetivo

Adicionar ao BaixarHSL um painel de navegação que permite ao usuário navegar dentro de sites autenticados (usando cookies de sessão) e capturar automaticamente a URL do stream `.m3u8` quando chegar na página da aula, sem precisar inspecionar o Network tab manualmente.

## Problema resolvido

Sites como `ead.envisionar.com` (WordPress/LearnDash) carregam o player de vídeo via JavaScript assíncrono. O Cheerio (scraping estático) não consegue capturar a URL do stream. O Puppeteer renderiza a página com JavaScript completo e intercepta as requisições de rede, capturando o `.m3u8` automaticamente.

## Fluxo de uso

1. Usuário faz login (automático ou cookies manuais)
2. Expande o painel "Navegar no site"
3. Informa a URL inicial (ex: `https://ead.envisionar.com`)
4. Navega pelos links: plataforma → curso → módulo → aula
5. Ao chegar na página com vídeo: banner "Stream encontrado!" aparece automaticamente
6. Clica "Usar este stream" → campo de download preenchido automaticamente
7. Clica "Baixar como MP4"

## Arquitetura

```
Browser (usuário)
  │
  └── BrowsePanel.tsx (novo componente colapsável)
        │
        └── POST /api/browse (nova rota Node.js)
              ├── Puppeteer + @sparticuz/chromium-min
              ├── Injeta cookies no contexto do browser
              ├── Navega para a URL
              ├── Intercepta requisições *.m3u8 via page.on('request')
              ├── Aguarda networkidle2 (máx 25s)
              ├── Extrai título + links do mesmo domínio
              └── Retorna { title, currentUrl, links, streamUrl }
```

## Componentes

### 1. API: `/api/browse` (Node.js serverless function)

**Runtime:** `export const runtime = 'nodejs'`

**Input:** `POST { url, cookies }`

**Lógica:**
1. Inicializar Puppeteer com `@sparticuz/chromium-min` (executablePath dinâmico)
2. Criar novo contexto de browser + página
3. Parsear cookies string (`nome=valor; outro=valor`) e injetar via `page.setCookie()`
4. Registrar interceptador: `page.on('request', ...)` captura URLs contendo `.m3u8`
5. `page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 })`
6. Extrair `document.title` e todos os `<a href>` do mesmo domínio via `page.evaluate()`
7. Fechar browser
8. Retornar `{ title, currentUrl, links: [{text, href}][], streamUrl: string | null }`

**Filtragem de links:**
- Apenas mesmo domínio (sem links externos)
- Excluir: `#`, `javascript:`, `mailto:`, `.pdf`, `.zip`, extensões de arquivo
- Excluir por texto: "Sair", "Logout", "Sign out" (case-insensitive)
- Deduplicar por href

**Tratamento de cookies:**
- Parsear `nome=valor; outro=valor2` → array de `{name, value, domain, path}`
- `domain`: extraído da URL de destino (ex: `.ead.envisionar.com`)

**Output:**
- Sucesso: `{ title, currentUrl, links: [{text, href}][], streamUrl: string | null }`
- Timeout: `{ error: "Tempo limite excedido (25s). Página pode ser muito pesada." }`
- Erro genérico: `{ error: "mensagem" }`

**Limitações documentadas:**
- Timeout de 25s (Vercel Hobby tem limite de 30s)
- Cold start de 8-12s na primeira requisição
- Não funciona com sites que exigem interação humana (reCAPTCHA visual)

### 2. Componente: `BrowsePanel.tsx`

**Props:** `{ cookies: string, onStreamFound: (streamUrl: string) => void, disabled?: boolean }`

**Estado interno:**
- `open: boolean` — painel colapsado/expandido
- `inputUrl: string` — campo de URL editável
- `history: { title, url, links }[]` — pilha de navegação
- `currentPage: { title, currentUrl, links, streamUrl } | null`
- `loading: boolean`
- `error: string | null`

**Layout (quando expandido):**
- Campo de URL + botão "Abrir" (para navegar diretamente)
- Breadcrumb: cada item da history é clicável (navega de volta)
- Botão "← Voltar" (pop do history stack)
- Título da página atual
- Lista de links clicáveis (cada um chama `navigate(href)`)
- Se `streamUrl` presente: banner verde com "Stream encontrado!" + botão "Usar este stream"
- Loading state com mensagem "Carregando página..." (primeira carga avisa sobre cold start)

**Comportamento:**
- Clicar num link: push da página atual no history, navega para o link
- Voltar: pop do history stack
- "Usar este stream": chama `onStreamFound(streamUrl)` e fecha o painel
- URL editável: permite colar qualquer URL e navegar diretamente

### 3. Modificação: `DownloadForm.tsx`

- Adicionar `<BrowsePanel cookies={cookies} onStreamFound={handleStreamFound} disabled={isLoading} />` entre o card de cookies e o card de extração
- `handleStreamFound(url)`: `setStreamUrl(url)` + `setDetectedStream(url)` + `setStreamType('hls')`

## Dependências novas

```json
"puppeteer-core": "^21.x",
"@sparticuz/chromium-min": "^123.x"
```

**Tamanho estimado da função:** ~38MB (dentro do limite de 50MB do Vercel Hobby)

## Testes

- `__tests__/browse-api.test.ts`: testa funções puras extraídas em `lib/browse-helpers.ts`
  - `parseCookiesString(str, domain)` → array de cookie objects
  - `filterLinks(links, baseUrl)` → deduplica, remove externos e inválidos
  - `extractDomain(url)` → retorna domínio com ponto (`.example.com`)

## Stack

Mesmo stack existente + `puppeteer-core` + `@sparticuz/chromium-min`.

## Não está no escopo

- Renderização visual do HTML da página (full browser proxy)
- Suporte a reCAPTCHA visual
- Histórico persistido entre sessões
- Download múltiplo de aulas em sequência
