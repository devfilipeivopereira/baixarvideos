export interface RawLink {
  text: string
  href: string
}

export interface CookieParam {
  name: string
  value: string
  domain: string
  path: string
}

const FILE_EXTENSIONS = ['.pdf', '.zip', '.jpg', '.jpeg', '.png', '.gif', '.mp4', '.mp3', '.doc', '.docx', '.xls', '.xlsx']
const LOGOUT_KEYWORDS = ['sair', 'logout', 'sign out', 'desconectar']

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function parseCookiesString(cookieStr: string, domain: string): CookieParam[] {
  if (!cookieStr.trim()) return []
  return cookieStr
    .split(';')
    .map((pair) => {
      const eqIdx = pair.indexOf('=')
      if (eqIdx === -1) return null
      const name = pair.slice(0, eqIdx).trim()
      const value = pair.slice(eqIdx + 1).trim()
      if (!name) return null
      return { name, value, domain, path: '/' }
    })
    .filter((c): c is CookieParam => c !== null)
}

export function filterLinks(links: RawLink[], baseUrl: string): RawLink[] {
  const baseDomain = extractDomain(baseUrl)
  const seen = new Set<string>()
  return links
    .filter(({ text, href }) => {
      if (!href) return false
      if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return false
      const lower = href.toLowerCase()
      if (FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return false
      const textLower = text.toLowerCase().trim()
      if (LOGOUT_KEYWORDS.some((kw) => textLower === kw)) return false
      if (href.startsWith('http')) {
        if (extractDomain(href) !== baseDomain) return false
      }
      if (seen.has(href)) return false
      seen.add(href)
      return true
    })
    .slice(0, 200)
}
