import {
  findLoginForm,
  buildFormBody,
  parseSetCookieHeaders,
  resolveFormAction,
} from '@/lib/form-login'

describe('findLoginForm', () => {
  it('returns null when no form with password field exists', () => {
    const html = '<html><body><form><input type="text" /></form></body></html>'
    expect(findLoginForm(html)).toBeNull()
  })

  it('detects a standard email+password form', () => {
    const html = `
      <form action="/login" method="post">
        <input type="email" name="email" />
        <input type="password" name="password" />
        <input type="hidden" name="_token" value="csrf123" />
      </form>
    `
    const result = findLoginForm(html)
    expect(result).not.toBeNull()
    expect(result!.action).toBe('/login')
    expect(result!.usernameField).toBe('email')
    expect(result!.passwordField).toBe('password')
    expect(result!.hiddenFields).toEqual({ _token: 'csrf123' })
  })

  it('falls back to name-based detection for username field', () => {
    const html = `
      <form action="/auth">
        <input type="text" name="usuario" />
        <input type="password" name="senha" />
      </form>
    `
    const result = findLoginForm(html)
    expect(result).not.toBeNull()
    expect(result!.usernameField).toBe('usuario')
  })

  it('returns null when password field has no name attribute', () => {
    const html = `
      <form action="/login">
        <input type="password" />
      </form>
    `
    expect(findLoginForm(html)).toBeNull()
  })
})

describe('buildFormBody', () => {
  it('builds URLSearchParams string with all fields', () => {
    const body = buildFormBody({
      usernameField: 'email',
      passwordField: 'password',
      username: 'user@test.com',
      password: 'secret',
      hiddenFields: { _token: 'csrf123' },
    })
    const params = new URLSearchParams(body)
    expect(params.get('email')).toBe('user@test.com')
    expect(params.get('password')).toBe('secret')
    expect(params.get('_token')).toBe('csrf123')
  })

  it('works with no hidden fields', () => {
    const body = buildFormBody({
      usernameField: 'login',
      passwordField: 'pass',
      username: 'admin',
      password: '1234',
      hiddenFields: {},
    })
    const params = new URLSearchParams(body)
    expect(params.get('login')).toBe('admin')
    expect(params.get('pass')).toBe('1234')
  })
})

describe('parseSetCookieHeaders', () => {
  it('extracts name=value pairs from Set-Cookie headers', () => {
    const headers = [
      'session=abc123; Path=/; HttpOnly',
      'token=xyz; Path=/; Secure',
    ]
    expect(parseSetCookieHeaders(headers)).toBe('session=abc123; token=xyz')
  })

  it('returns empty string for empty array', () => {
    expect(parseSetCookieHeaders([])).toBe('')
  })

  it('handles single cookie', () => {
    expect(parseSetCookieHeaders(['user_id=42; Path=/'])).toBe('user_id=42')
  })
})

describe('resolveFormAction', () => {
  it('resolves relative action against base URL', () => {
    expect(resolveFormAction('/auth/login', 'https://example.com/signin'))
      .toBe('https://example.com/auth/login')
  })

  it('returns absolute action URL unchanged', () => {
    expect(resolveFormAction('https://example.com/auth', 'https://example.com/signin'))
      .toBe('https://example.com/auth')
  })

  it('handles action-less forms by returning the base URL', () => {
    expect(resolveFormAction('', 'https://example.com/login'))
      .toBe('https://example.com/login')
  })
})
