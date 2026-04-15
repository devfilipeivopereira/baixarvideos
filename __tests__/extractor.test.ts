import { extractStreamUrl } from '@/lib/extractor'

describe('extractStreamUrl', () => {
  it('finds m3u8 URL in a script tag', () => {
    const html = `
      <html><body>
      <script>var player = { src: "https://cdn.example.com/video/index.m3u8?token=abc" };</script>
      </body></html>
    `
    expect(extractStreamUrl(html)).toBe('https://cdn.example.com/video/index.m3u8?token=abc')
  })

  it('finds m3u8 URL in an HTML attribute', () => {
    const html = `<video src="https://cdn.example.com/stream.m3u8"></video>`
    expect(extractStreamUrl(html)).toBe('https://cdn.example.com/stream.m3u8')
  })

  it('returns null when no stream URL found', () => {
    const html = `<html><body><p>No video here</p></body></html>`
    expect(extractStreamUrl(html)).toBeNull()
  })

  it('prefers m3u8 over mpd when both present', () => {
    const html = `
      <script>
        var hls = "https://cdn.example.com/stream.m3u8";
        var dash = "https://cdn.example.com/stream.mpd";
      </script>
    `
    expect(extractStreamUrl(html)).toBe('https://cdn.example.com/stream.m3u8')
  })
})
