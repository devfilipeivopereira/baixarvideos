---
name: BaixarHSL — Login Automático por Formulário
description: Adiciona autenticação automática via detecção de formulário HTML para sites restritos
type: project
---

# Login Automático por Formulário — Design Spec

## Objetivo

Adicionar ao BaixarHSL a capacidade de autenticar automaticamente em sites que usam login por formulário HTML padrão, eliminando a necessidade de copiar cookies manualmente do DevTools.

## Fluxo de uso

1. Usuário expande o painel "Fazer Login Automático"
2. Informa: URL da página de login + usuário/email + senha
3. Clica em "Entrar"
4. App detecta o formulário, submete as credenciais
5. Cookies de sessão são capturados automaticamente e preenchidos no campo existente
6. Usuário prossegue normalmente com a extração/download

## Arquitetura

```
Browser (usuário)
  │
  └── LoginPanel.tsx (novo componente colapsável)
        │
        └── POST /api/login (nova Edge Function)
              ├── Fetch da página de login (Cheerio)
              ├── Detecção do formulário com input[type=password]
              ├── POST para o form action com credenciais + hidden fields
              ├── Captura de Set-Cookie dos headers de resposta
              └── Retorna { cookies, success, message }
```

## Componentes

### 1. API: `/api/login` (Node.js serverless function)

**Runtime:** `export const runtime = 'nodejs'` — Cheerio requer Node.js built-ins; não usar Edge Runtime nesta rota.

**Input:** `POST { loginUrl, username, password }`

**Lógica:**
1. Fetch da página de login com headers de browser (User-Agent, Accept, Accept-Language)
2. Cheerio: encontrar `<form>` que contém `<input type="password">`
3. Extrair `action` do form (resolver URL relativa com `new URL(action, loginUrl)`)
4. Coletar todos os campos hidden (CSRF tokens, honeypots)
5. Identificar campo de usuário: busca por `type=email`, `name` contendo `email`, `user`, `login`, `cpf` (nessa ordem de prioridade)
6. Identificar campo de senha: `type=password`
7. Montar body do POST com todos os campos em `URLSearchParams`
8. Fazer POST para o form action com `redirect: 'manual'` e `Content-Type: application/x-www-form-urlencoded`
9. **Captura manual de Set-Cookie**: usar `redirect: 'manual'` porque fetch com `redirect: 'follow'` descarta Set-Cookie das respostas intermediárias (302). Coletar `set-cookie` do POST response. Se status 3xx, fazer GET manual para o Location e coletar mais cookies. Repetir até status 2xx (máx 5 redirects).
10. Serializar todos os cookies acumulados como `nome=valor; nome2=valor2`
11. **Detecção de sucesso**: comparar `response.url` final com `loginUrl`. Se URL final é diferente da página de login → sucesso. Presença de cookies sem mudança de URL → falha (site pode ter setado cookies analíticos mesmo com credenciais erradas).

**Output:**
- Sucesso: `{ success: true, cookies: "session=abc; token=xyz", message: "Login realizado com sucesso" }`
- Formulário não encontrado: `{ success: false, cookies: "", message: "Formulário de login não encontrado na página" }`
- Credenciais rejeitadas (URL não mudou após POST): `{ success: false, cookies: "", message: "Login rejeitado — verifique suas credenciais" }`
- Timeout: `{ success: false, cookies: "", message: "Tempo limite excedido (25s)" }`

**Limitações documentadas:**
- Não funciona com reCAPTCHA, 2FA, ou login via JavaScript (fetch/XHR)
- Nesses casos, a mensagem orienta o usuário a usar cookies manuais

### 2. Componente: `LoginPanel.tsx`

- Painel colapsável (toggle "Fazer Login Automático" / "Ocultar")
- Campos: `loginUrl`, `username`, `password` (com `type="password"`)
- Botão "Entrar" com estado de loading
- Ao sucesso: chama callback `onLoginSuccess(cookies: string)` para preencher o campo de cookies no `DownloadForm`
- Exibe `StatusMessage` com feedback de sucesso ou erro

### 3. Modificação: `DownloadForm.tsx`

- Adicionar `<LoginPanel onLoginSuccess={handleLoginSuccess} />` acima do textarea de cookies
- `handleLoginSuccess(cookies)` → `setCookies(cookies)` + exibe confirmação

## Testes

- `__tests__/login-api.test.ts`: testa a lógica de extração de formulário isolada — identificação de campos, serialização do body, serialização de cookies
- Funções puras extraídas em `lib/form-login.ts`: `findLoginForm`, `buildFormBody`, `parseSetCookieHeaders`

## Stack

Mesmo stack existente: Next.js 16, Cheerio (Node.js runtime para /api/login), Tailwind, shadcn/ui. As demais rotas mantêm Edge Runtime.

## Não está no escopo

- Login via JavaScript/API (SPAs)
- Suporte a reCAPTCHA ou 2FA
- Armazenamento de credenciais
- Multi-step login flows
