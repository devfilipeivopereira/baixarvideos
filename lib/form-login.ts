import * as cheerio from 'cheerio'

export interface LoginForm {
  action: string
  usernameField: string
  passwordField: string
  hiddenFields: Record<string, string>
}

const NAME_HINTS = ['email', 'user', 'login', 'cpf', 'username', 'usuario']

export function findLoginForm(html: string): LoginForm | null {
  const $ = cheerio.load(html)

  let targetForm: ReturnType<typeof $> | null = null
  $('form').each((_, el) => {
    if ($(el).find('input[type=password]').length > 0) {
      targetForm = $(el) as unknown as ReturnType<typeof $>
      return false
    }
  })
  if (!targetForm) return null

  const form = targetForm as ReturnType<typeof $>

  const passwordInput = form.find('input[type=password]').first()
  const passwordField = passwordInput.attr('name')
  if (!passwordField) return null

  let usernameField: string | null = null
  const emailInput = form.find('input[type=email]').first()
  if (emailInput.attr('name')) {
    usernameField = emailInput.attr('name')!
  } else {
    const textInput = form.find('input[type=text]').first()
    if (textInput.attr('name')) {
      usernameField = textInput.attr('name')!
    } else {
      form.find('input:not([type=password]):not([type=hidden]):not([type=submit]):not([type=checkbox])').each((_, el) => {
        const name = $(el).attr('name') ?? ''
        if (NAME_HINTS.some((hint) => name.toLowerCase().includes(hint))) {
          usernameField = name
          return false
        }
      })
    }
  }
  if (!usernameField) return null

  const hiddenFields: Record<string, string> = {}
  form.find('input[type=hidden]').each((_, el) => {
    const name = $(el).attr('name')
    const value = $(el).attr('value') ?? ''
    if (name) hiddenFields[name] = value
  })

  const rawAction = form.attr('action') ?? ''
  return { action: rawAction, usernameField, passwordField, hiddenFields }
}

export function buildFormBody(opts: {
  usernameField: string
  passwordField: string
  username: string
  password: string
  hiddenFields: Record<string, string>
}): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(opts.hiddenFields)) {
    params.append(k, v)
  }
  params.append(opts.usernameField, opts.username)
  params.append(opts.passwordField, opts.password)
  return params.toString()
}

export function parseSetCookieHeaders(headers: string[]): string {
  return headers
    .map((h) => h.split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

export function resolveFormAction(action: string, pageUrl: string): string {
  if (!action) return pageUrl
  try {
    return new URL(action, pageUrl).href
  } catch {
    return pageUrl
  }
}
