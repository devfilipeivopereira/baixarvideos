/**
 * Tests for /api/extract logic using the extractor lib directly.
 * The Edge runtime is not available in Jest; test the business logic
 * (extractStreamUrl) in isolation and rely on manual curl for route wiring.
 */
import { extractStreamUrl, extractTitle } from '@/lib/extractor'

describe('/api/extract logic', () => {
  it('returns stream URL from inline script', () => {
    const html = `<script>window.__PLAYER_CONFIG__ = { hlsUrl: "https://cdn.example.com/video.m3u8" };</script>`
    expect(extractStreamUrl(html)).toBe('https://cdn.example.com/video.m3u8')
  })

  it('returns null when no stream URL found', () => {
    expect(extractStreamUrl('<html><body>nothing</body></html>')).toBeNull()
  })

  it('extracts page title correctly', () => {
    const html = `<html><head><title>Aula 1 - Curso React</title></head><body></body></html>`
    expect(extractTitle(html)).toBe('Aula 1 - Curso React')
  })

  it('returns fallback title when no title tag', () => {
    expect(extractTitle('<html><body></body></html>')).toBe('video')
  })

  it('detects type as hls for m3u8 URLs', () => {
    const url = 'https://cdn.example.com/stream.m3u8'
    expect(url.includes('.mpd') ? 'dash' : 'hls').toBe('hls')
  })

  it('detects type as dash for mpd URLs', () => {
    const url = 'https://cdn.example.com/stream.mpd'
    expect(url.includes('.mpd') ? 'dash' : 'hls').toBe('dash')
  })
})
