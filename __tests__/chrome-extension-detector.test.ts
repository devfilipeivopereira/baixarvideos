import detector from '../chrome-extension/detector.js'

const {
  detectStreamFromRequest,
  detectStreamFromResponseHeaders,
  extractStreamMatchesFromText,
} = detector

describe('chrome extension stream detector', () => {
  describe('detectStreamFromRequest', () => {
    it('resolves relative HLS urls against the current page', () => {
      expect(
        detectStreamFromRequest('/media/master.m3u8?token=abc', 'https://player.example.com/course/lesson')
      ).toEqual({
        type: 'hls',
        url: 'https://player.example.com/media/master.m3u8?token=abc',
      })
    })

    it('detects DASH manifests by URL extension', () => {
      expect(
        detectStreamFromRequest('https://cdn.example.com/stream/manifest.mpd?quality=1080')
      ).toEqual({
        type: 'dash',
        url: 'https://cdn.example.com/stream/manifest.mpd?quality=1080',
      })
    })

    it('detects Vimeo adaptive playlist JSON as a stream candidate', () => {
      expect(
        detectStreamFromRequest('https://vod-adaptive-ak.vimeocdn.com/path/to/playlist.json?token=abc')
      ).toEqual({
        type: 'vimeo',
        url: 'https://vod-adaptive-ak.vimeocdn.com/path/to/playlist.json?token=abc',
      })
    })

    it('detects Vimeo player config endpoints as a stream candidate', () => {
      expect(
        detectStreamFromRequest('https://player.vimeo.com/video/123456789/config?h=abcdef')
      ).toEqual({
        type: 'vimeo',
        url: 'https://player.vimeo.com/video/123456789/config?h=abcdef',
      })
    })

    it('detects direct MP4 and WEBM files as progressive downloads', () => {
      expect(
        detectStreamFromRequest('https://cdn.example.com/video/lesson.mp4?token=abc')
      ).toEqual({
        type: 'progressive',
        url: 'https://cdn.example.com/video/lesson.mp4?token=abc',
      })

      expect(
        detectStreamFromRequest('https://cdn.example.com/video/lesson.webm')
      ).toEqual({
        type: 'progressive',
        url: 'https://cdn.example.com/video/lesson.webm',
      })
    })

    it('detects YouTube googlevideo playback URLs as direct progressive streams', () => {
      expect(
        detectStreamFromRequest(
          'https://rr3---sn-example.googlevideo.com/videoplayback?source=youtube&itag=22&mime=video%2Fmp4&sig=abc123'
        )
      ).toEqual({
        type: 'progressive',
        url: 'https://rr3---sn-example.googlevideo.com/videoplayback?source=youtube&itag=22&mime=video%2Fmp4&sig=abc123',
      })
    })

    it('ignores audio-only googlevideo playback URLs', () => {
      expect(
        detectStreamFromRequest(
          'https://rr3---sn-example.googlevideo.com/videoplayback?source=youtube&itag=251&mime=audio%2Fwebm&sig=abc123'
        )
      ).toBeNull()
    })

    it('ignores known audio-only YouTube itags even when mime is missing', () => {
      expect(
        detectStreamFromRequest(
          'https://rr3---sn-example.googlevideo.com/videoplayback?source=youtube&itag=251&sig=abc123'
        )
      ).toBeNull()
    })

    it('ignores undeciphered YouTube cipher playback URLs', () => {
      expect(
        detectStreamFromRequest(
          'https://rr3---sn-example.googlevideo.com/videoplayback?source=youtube&itag=22&mime=video%2Fmp4&s=encrypted-signature'
        )
      ).toBeNull()
    })


    it('detects additional direct video formats like MKV as progressive downloads', () => {
      expect(
        detectStreamFromRequest('https://cdn.example.com/video/lesson.mkv?token=abc')
      ).toEqual({
        type: 'progressive',
        url: 'https://cdn.example.com/video/lesson.mkv?token=abc',
      })
    })

    it('detects Smooth Streaming manifests and routes them through HLS handling', () => {
      expect(
        detectStreamFromRequest('https://cdn.example.com/channel/video.ism/manifest(format=m3u8-aapl)')
      ).toEqual({
        type: 'hls',
        url: 'https://cdn.example.com/channel/video.ism/manifest(format=m3u8-aapl)',
      })
    })
    it('ignores adaptive MP4 range fragments that are not standalone files', () => {
      expect(
        detectStreamFromRequest(
          'https://vod-adaptive-ak.vimeocdn.com/exp=1776442404~acl=%2Fclip%2F*~hmac=abc123/clip/v2/range/prot/cmFuZ2U9MzI3MTgxNy0zMzQ3Nzkw/avf/b3ca45c4-36bf-4701-83a9-3fdd6a8f677a.mp4?pathsig=8c953e4f~token&r=dXM%3D&range=3271817-3347790'
        )
      ).toBeNull()
    })

    it('reconstructs Vimeo playlist.json from range URLs that include ../ traversal', () => {
      expect(
        detectStreamFromRequest(
          'https://vod-adaptive-ak.vimeocdn.com/exp=1776783327~acl=%2Fd46d2b63-4408-4488-99a0-3eaaf51ded22%2Fpsid%3De18cfb419da16877abcf5b336af679905ae68845ea6af3399a8e18df3428c2e2%2F%2A~hmac=f765d2d611160934dd9544ae401af88455f1c7122e13b9006e67d6a91ba8c3cb/d46d2b63-4408-4488-99a0-3eaaf51ded22/psid=e18cfb419da16877abcf5b336af679905ae68845ea6af3399a8e18df3428c2e2/v2/playlist/av/primary/prot/cXNyPTE/../../../../../range/prot/cmFuZ2U9MTUzODY3LTIyOTkzOQ/avf/efd3184f-40e9-4099-9b80-98c3b1e4d310.mp4?pathsig=8c953e4f~CGg1YX-E-TCE9IKRvApck6rSQL_7wXQ_FfE7F6kJlPU&r=dXM%3D&range=153867-229939'
        )
      ).toEqual({
        type: 'vimeo',
        url: 'https://vod-adaptive-ak.vimeocdn.com/exp=1776783327~acl=%2Fd46d2b63-4408-4488-99a0-3eaaf51ded22%2Fpsid%3De18cfb419da16877abcf5b336af679905ae68845ea6af3399a8e18df3428c2e2%2F%2A~hmac=f765d2d611160934dd9544ae401af88455f1c7122e13b9006e67d6a91ba8c3cb/d46d2b63-4408-4488-99a0-3eaaf51ded22/psid=e18cfb419da16877abcf5b336af679905ae68845ea6af3399a8e18df3428c2e2/v2/playlist/av/primary/prot/cXNyPTE/playlist.json?pathsig=8c953e4f~CGg1YX-E-TCE9IKRvApck6rSQL_7wXQ_FfE7F6kJlPU&r=dXM%3D',
      })
    })
  })

  describe('detectStreamFromResponseHeaders', () => {
    it('detects HLS responses even when the URL has no .m3u8 suffix', () => {
      expect(
        detectStreamFromResponseHeaders({
          url: 'https://cdn.example.com/playback?id=123',
          responseHeaders: [
            { name: 'Content-Type', value: 'application/vnd.apple.mpegurl; charset=utf-8' },
          ],
        })
      ).toEqual({
        type: 'hls',
        url: 'https://cdn.example.com/playback?id=123',
      })
    })

    it('detects direct video responses by content-type', () => {
      expect(
        detectStreamFromResponseHeaders({
          url: 'https://cdn.example.com/download?id=456',
          responseHeaders: [
            { name: 'Content-Type', value: 'video/mp4' },
          ],
        })
      ).toEqual({
        type: 'progressive',
        url: 'https://cdn.example.com/download?id=456',
      })
    })

    it('ignores partial adaptive fragments even when the response content-type is video/mp4', () => {
      expect(
        detectStreamFromResponseHeaders({
          url: 'https://vod-adaptive-ak.vimeocdn.com/clip/v2/range/prot/cmFuZ2U9MzI3MTgxNy0zMzQ3Nzkw/avf/file.mp4?range=3271817-3347790',
          responseHeaders: [
            { name: 'Content-Type', value: 'video/mp4' },
          ],
        })
      ).toBeNull()
    })

    it('ignores non-stream responses', () => {
      expect(
        detectStreamFromResponseHeaders({
          url: 'https://api.example.com/data',
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        })
      ).toBeNull()
    })
  })

  describe('extractStreamMatchesFromText', () => {
    it('extracts HLS and DASH manifests from Vimeo config JSON', () => {
      const body = JSON.stringify({
        request: {
          files: {
            hls: {
              default_cdn: 'fastly_skyfire',
              cdns: {
                fastly_skyfire: {
                  url: 'https://vod-adaptive-ak.vimeocdn.com/exp=1712345678~acl=%2F12345%2F*~hmac=abc123/12345/sep/video/master.m3u8?query_string_ranges=1',
                },
              },
            },
            dash: {
              cdns: {
                fastly_skyfire: {
                  url: 'https://vod-adaptive-ak.vimeocdn.com/exp=1712345678~acl=%2F12345%2F*~hmac=abc123/12345/sep/video/master.mpd',
                },
              },
            },
          },
        },
      })

      expect(extractStreamMatchesFromText(body)).toEqual([
        {
          type: 'hls',
          url: 'https://vod-adaptive-ak.vimeocdn.com/exp=1712345678~acl=%2F12345%2F*~hmac=abc123/12345/sep/video/master.m3u8?query_string_ranges=1',
        },
        {
          type: 'dash',
          url: 'https://vod-adaptive-ak.vimeocdn.com/exp=1712345678~acl=%2F12345%2F*~hmac=abc123/12345/sep/video/master.mpd',
        },
      ])
    })

    it('normalizes escaped JSON urls before extracting manifests', () => {
      const body = '{"url":"https:\\/\\/player.example.com\\/live\\/playlist.m3u8?token=abc"}'

      expect(extractStreamMatchesFromText(body)).toEqual([
        {
          type: 'hls',
          url: 'https://player.example.com/live/playlist.m3u8?token=abc',
        },
      ])
    })

    it('extracts Vimeo config urls from embedded player markup and script payloads', () => {
      const body = `
        <iframe src="https://player.vimeo.com/video/123456789?h=abcdef&title=0"></iframe>
        <div data-config-url="https://player.vimeo.com/video/123456789/config?h=abcdef"></div>
        <script>
          window.__player = {
            configUrl: "https://player.vimeo.com/video/987654321/config?h=zyx987"
          };
        </script>
      `

      expect(extractStreamMatchesFromText(body)).toEqual([
        {
          type: 'vimeo',
          url: 'https://player.vimeo.com/video/123456789/config?h=abcdef&title=0',
        },
        {
          type: 'vimeo',
          url: 'https://player.vimeo.com/video/123456789/config?h=abcdef',
        },
        {
          type: 'vimeo',
          url: 'https://player.vimeo.com/video/987654321/config?h=zyx987',
        },
      ])
    })

    it('extracts direct media files from HTML and script payloads', () => {
      const body = `
        <video src="https://cdn.example.com/assets/aula.mp4?download=1" poster="https://cdn.example.com/poster.jpg"></video>
        <source src="/media/trailer.webm" type="video/webm" />
        <script>
          window.media = { file: "https://cdn.example.com/assets/bonus.mov" };
        </script>
      `

      const matches = extractStreamMatchesFromText(body, 'https://player.example.com/course/lesson')

      expect(matches).toHaveLength(3)
      expect(matches).toEqual(expect.arrayContaining([
        {
          type: 'progressive',
          url: 'https://cdn.example.com/assets/aula.mp4?download=1',
        },
        {
          type: 'progressive',
          url: 'https://player.example.com/media/trailer.webm',
        },
        {
          type: 'progressive',
          url: 'https://cdn.example.com/assets/bonus.mov',
        },
      ]))
    })

    it('extracts direct YouTube playback URLs from player JSON payloads', () => {
      const body = JSON.stringify({
        streamingData: {
          formats: [
            {
              itag: 22,
              url: 'https://rr3---sn-example.googlevideo.com/videoplayback?source=youtube&itag=22&mime=video%2Fmp4&sig=abc123',
            },
          ],
          adaptiveFormats: [
            {
              itag: 251,
              url: 'https://rr3---sn-example.googlevideo.com/videoplayback?source=youtube&itag=251&mime=audio%2Fwebm&sig=abc123',
            },
          ],
        },
      })

      expect(extractStreamMatchesFromText(body)).toEqual([
        {
          type: 'progressive',
          url: 'https://rr3---sn-example.googlevideo.com/videoplayback?source=youtube&itag=22&mime=video%2Fmp4&sig=abc123',
        },
      ])
    })
  })
})
