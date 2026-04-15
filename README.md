# BaixarHSL — HLS Video Downloader

Aplicação web pessoal hospedada no Vercel para baixar vídeos HLS (`.m3u8`) de sites autenticados diretamente para o seu PC.

## Funcionalidades

- **Extração automática de stream**: cole a URL da página do vídeo e o app encontra o link `.m3u8`
- **Login automático**: informe usuário e senha — o app detecta o formulário de login e autentica automaticamente
- **Download com ffmpeg.wasm**: monta os segmentos em MP4 direto no navegador, sem upload para servidor
- **Proxy CORS autenticado**: bypass de CORS usando Edge Functions com seus cookies de sessão
- **Suporte a cookies manuais**: para sites com reCAPTCHA/2FA, cole os cookies do DevTools

## Como usar

### Download direto (URL pública)

1. Cole a URL do stream `.m3u8` no campo "URL do stream"
2. Clique em **Baixar como MP4**

### Sites autenticados — Login automático

1. Expanda "Fazer Login Automático"
2. Informe a URL da página de login + usuário + senha
3. Clique em **Entrar** — cookies são preenchidos automaticamente
4. Cole a URL da página do vídeo e clique em **Extrair URL do stream**
5. Clique em **Baixar como MP4**

### Sites autenticados — Cookies manuais

1. Abra o site no browser, faça login normalmente
2. DevTools (F12) → Application → Cookies → copie os valores como `nome=valor; outro=valor2`
3. Cole no campo "Cookies de sessão"
4. Prossiga com a extração e download

## Limitações

- Login automático **não funciona** com reCAPTCHA, 2FA ou login via JavaScript (SPAs)
- Conteúdo com DRM (Widevine/PlayReady) não é suportado
- Formato DASH (`.mpd`) não suportado — use apenas `.m3u8`
- Vídeos muito longos podem ser lentos no primeiro uso (ffmpeg.wasm ~30 MB, cacheado depois)

## Stack técnica

| Camada | Tecnologia |
|--------|-----------|
| Framework | Next.js 16 (App Router) |
| Estilo | Tailwind CSS + shadcn/ui |
| Scraping/Login | Cheerio (Node.js runtime) |
| Proxy | Vercel Edge Functions |
| Download | @ffmpeg/ffmpeg@0.11.x (WASM, client-side) |
| Deploy | Vercel |

## Desenvolvimento local

```bash
npm install
npm run dev
# acesse http://localhost:3000

npm test        # testes unitários
npm run build   # build de produção
```

## Deploy

```bash
npx vercel --prod
```

## Segurança

- Cookies trafegam apenas no body HTTPS — nunca em query strings
- Nenhuma credencial é armazenada — trafegam apenas na requisição
- Uso pessoal — não exponha publicamente com suas credenciais
