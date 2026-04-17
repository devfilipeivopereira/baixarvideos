import helper from '../chrome-extension/interceptor-detector.js'

const { createInterceptorDetector } = helper

describe('chrome extension interceptor detector fallback', () => {
  it('falls back to a local detector when the page global is missing', () => {
    const detector = createInterceptorDetector(null)

    expect(
      detector.detectStreamFromRequest('https://vod-adaptive-ak.vimeocdn.com/path/to/playlist.json?token=abc')
    ).toEqual({
      type: 'vimeo',
      url: 'https://vod-adaptive-ak.vimeocdn.com/path/to/playlist.json?token=abc',
    })
  })

  it('extracts manifests from escaped JSON payloads with the fallback detector', () => {
    const detector = createInterceptorDetector(undefined)

    expect(
      detector.extractStreamMatchesFromText(
        '{"url":"https:\\/\\/player.example.com\\/live\\/playlist.m3u8?token=abc"}'
      )
    ).toEqual([
      {
        type: 'hls',
        url: 'https://player.example.com/live/playlist.m3u8?token=abc',
      },
    ])
  })
})
