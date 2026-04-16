import { parseCookiesString, filterLinks, extractDomain } from '@/lib/browse-helpers'

describe('extractDomain', () => {
  it('extracts hostname without leading dot', () => {
    expect(extractDomain('https://ead.envisionar.com/courses')).toBe('ead.envisionar.com')
  })
  it('handles localhost correctly (no leading dot)', () => {
    expect(extractDomain('http://localhost:3000/page')).toBe('localhost')
  })
  it('handles subdomains correctly', () => {
    expect(extractDomain('https://sub.example.com/path')).toBe('sub.example.com')
  })
})

describe('parseCookiesString', () => {
  it('parses multiple cookies into array', () => {
    const result = parseCookiesString('a=1; b=2', 'example.com')
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ name: 'a', value: '1' })
    expect(result[1]).toMatchObject({ name: 'b', value: '2' })
  })
  it('assigns correct domain without leading dot', () => {
    const result = parseCookiesString('session=abc', 'ead.envisionar.com')
    expect(result[0].domain).toBe('ead.envisionar.com')
  })
  it('assigns path / to all cookies', () => {
    const result = parseCookiesString('x=1', 'example.com')
    expect(result[0].path).toBe('/')
  })
  it('returns empty array for empty string', () => {
    expect(parseCookiesString('', 'example.com')).toHaveLength(0)
  })
  it('trims whitespace around name and value', () => {
    const result = parseCookiesString('  key  =  val  ', 'example.com')
    expect(result[0]).toMatchObject({ name: 'key', value: 'val' })
  })
})

describe('filterLinks', () => {
  const base = 'https://ead.envisionar.com'
  it('keeps same-domain links', () => {
    const links = [{ text: 'Aula 1', href: 'https://ead.envisionar.com/aula/1' }]
    expect(filterLinks(links, base)).toHaveLength(1)
  })
  it('removes external domain links', () => {
    const links = [{ text: 'Externo', href: 'https://google.com' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })
  it('removes javascript: hrefs', () => {
    const links = [{ text: 'Click', href: 'javascript:void(0)' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })
  it('removes # hrefs', () => {
    const links = [{ text: 'Anchor', href: '#section' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })
  it('removes mailto: hrefs', () => {
    const links = [{ text: 'Email', href: 'mailto:a@b.com' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })
  it('removes file extension links (.pdf)', () => {
    const links = [{ text: 'PDF', href: 'https://ead.envisionar.com/doc.pdf' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })
  it('removes file extension links (.zip)', () => {
    const links = [{ text: 'Zip', href: 'https://ead.envisionar.com/file.zip' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })
  it('removes logout links by text — Sair', () => {
    const links = [{ text: 'Sair', href: 'https://ead.envisionar.com/logout' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })
  it('removes logout links by text — Logout (case-insensitive)', () => {
    const links = [{ text: 'LOGOUT', href: 'https://ead.envisionar.com/logout' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })
  it('removes logout links by text — Desconectar', () => {
    const links = [{ text: 'Desconectar', href: 'https://ead.envisionar.com/sair' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })
  it('deduplicates by href', () => {
    const links = [
      { text: 'Aula 1', href: 'https://ead.envisionar.com/aula/1' },
      { text: 'Aula 1 (dup)', href: 'https://ead.envisionar.com/aula/1' },
    ]
    expect(filterLinks(links, base)).toHaveLength(1)
  })
  it('limits to 200 links', () => {
    const links = Array.from({ length: 250 }, (_, i) => ({
      text: `Link ${i}`,
      href: `https://ead.envisionar.com/page/${i}`,
    }))
    expect(filterLinks(links, base)).toHaveLength(200)
  })
})
