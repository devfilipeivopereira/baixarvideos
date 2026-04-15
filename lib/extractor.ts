import * as cheerio from 'cheerio'

const M3U8_REGEX = /https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi
const MPD_REGEX = /https?:\/\/[^\s"']+\.mpd[^\s"']*/gi

/**
 * Searches raw HTML for HLS (.m3u8) or DASH (.mpd) stream URLs.
 * Prefers m3u8 over mpd. Returns null if nothing found.
 */
export function extractStreamUrl(html: string): string | null {
  // Try m3u8 first
  const m3u8Matches = html.match(M3U8_REGEX)
  if (m3u8Matches && m3u8Matches.length > 0) {
    return m3u8Matches[0]
  }

  // Fallback to mpd
  const mpdMatches = html.match(MPD_REGEX)
  if (mpdMatches && mpdMatches.length > 0) {
    return mpdMatches[0]
  }

  // Try cheerio for src attributes on video/source elements
  const $ = cheerio.load(html)
  const videoSrc =
    $('video[src]').attr('src') ||
    $('source[src]').attr('src') ||
    null

  if (videoSrc && (videoSrc.includes('.m3u8') || videoSrc.includes('.mpd'))) {
    return videoSrc
  }

  return null
}

/**
 * Extracts the page title from HTML, or returns a fallback.
 */
export function extractTitle(html: string): string {
  const $ = cheerio.load(html)
  return $('title').first().text().trim() || 'video'
}
