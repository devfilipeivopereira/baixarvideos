'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusMessage } from '@/components/StatusMessage'

interface Props {
  onLoginSuccess: (cookies: string) => void
  disabled?: boolean
}

export function LoginPanel({ onLoginSuccess, disabled = false }: Props) {
  const [open, setOpen] = useState(false)
  const [loginUrl, setLoginUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ type: 'error' | 'success' | 'info'; message: string } | null>(null)

  const handleLogin = async () => {
    if (!loginUrl || !username || !password) return
    setLoading(true)
    setStatus(null)

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginUrl, username, password }),
    })

    const data = await res.json() as { success: boolean; cookies: string; message: string }
    setLoading(false)

    if (data.success) {
      setStatus({ type: 'success', message: data.message })
      onLoginSuccess(data.cookies)
      setUsername('')
      setPassword('')
    } else {
      setStatus({ type: 'error', message: data.message })
    }
  }

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <CardTitle className="flex items-center justify-between text-base">
          <span>Fazer Login Automático</span>
          <span className="text-muted-foreground text-sm font-normal">
            {open ? '▲ Ocultar' : '▼ Expandir'}
          </span>
        </CardTitle>
        {!open && (
          <CardDescription>
            Entre com usuário e senha para sites com formulário de login padrão
          </CardDescription>
        )}
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
          <CardDescription>
            Funciona em sites com formulário HTML padrão. Não funciona com reCAPTCHA, 2FA ou login via JavaScript.
          </CardDescription>

          <div className="space-y-1">
            <Label htmlFor="login-url">URL da página de login</Label>
            <Input
              id="login-url"
              placeholder="https://plataforma.com/login"
              value={loginUrl}
              onChange={(e) => setLoginUrl(e.target.value)}
              disabled={loading || disabled}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="login-username">Usuário / E-mail</Label>
            <Input
              id="login-username"
              placeholder="seu@email.com"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading || disabled}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="login-password">Senha</Label>
            <Input
              id="login-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading || disabled}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            />
          </div>

          <Button
            onClick={handleLogin}
            disabled={loading || disabled || !loginUrl || !username || !password}
            className="w-full"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </Button>

          {status && <StatusMessage status={status.type} message={status.message} />}
        </CardContent>
      )}
    </Card>
  )
}
