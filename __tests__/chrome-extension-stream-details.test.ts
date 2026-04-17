import '../chrome-extension/detector.js'
import streamDetails from '../chrome-extension/stream-details.js'

const { resolveVimeoStreamDetails } = streamDetails

describe('chrome extension vimeo stream details', () => {
  it('extracts title, thumbnail and sorted progressive resolutions from config payload', () => {
    const payload = JSON.stringify({
      video: {
        title: 'Aula 01 - Apresentacao',
        thumbs: {
          '640': 'https://i.vimeocdn.com/video/cover-640.jpg',
          '1280': 'https://i.vimeocdn.com/video/cover-1280.jpg',
        },
      },
      request: {
        files: {
          progressive: [
            {
              url: 'https://vod-progressive.akamaized.net/video/720p.mp4?token=abc',
              quality: '720p',
              fps: 30,
              width: 1280,
              height: 720,
            },
            {
              url: 'https://vod-progressive.akamaized.net/video/1080p.mp4?token=abc',
              quality: '1080p',
              fps: 30,
              width: 1920,
              height: 1080,
            },
          ],
        },
      },
    })

    expect(
      resolveVimeoStreamDetails(
        payload,
        'https://player.vimeo.com/video/123456789/config?h=abcdef'
      )
    ).toEqual({
      canDownloadDash: false,
      canDownloadDirect: true,
      canDownloadHls: false,
      canDownloadVimeoPlaylist: false,
      isDrmProtected: false,
      options: [
        expect.objectContaining({
          url: 'https://vod-progressive.akamaized.net/video/1080p.mp4?token=abc',
          label: '1080p (MP4)',
        }),
        expect.objectContaining({
          url: 'https://vod-progressive.akamaized.net/video/720p.mp4?token=abc',
          label: '720p (MP4)',
        }),
      ],
      selectedUrl: 'https://vod-progressive.akamaized.net/video/1080p.mp4?token=abc',
      selectedType: 'progressive',
      thumbnailUrl: 'https://i.vimeocdn.com/video/cover-1280.jpg',
      title: 'Aula 01 - Apresentacao',
    })
  })

  it('falls back to HLS when the Vimeo config has no progressive list', () => {
    const payload = JSON.stringify({
      video: {
        title: 'Aula HLS',
        thumbs: {
          '640': 'https://i.vimeocdn.com/video/hls-640.jpg',
        },
      },
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
        },
      },
    })

    expect(
      resolveVimeoStreamDetails(
        payload,
        'https://player.vimeo.com/video/123456789/config?h=abcdef'
      )
    ).toEqual({
      canDownloadDash: false,
      canDownloadDirect: false,
      canDownloadHls: true,
      canDownloadVimeoPlaylist: false,
      isDrmProtected: false,
      options: [],
      selectedUrl: 'https://vod-adaptive-ak.vimeocdn.com/exp=1712345678~acl=%2F12345%2F*~hmac=abc123/12345/sep/video/master.m3u8?query_string_ranges=1',
      selectedType: 'hls',
      thumbnailUrl: 'https://i.vimeocdn.com/video/hls-640.jpg',
      title: 'Aula HLS',
    })
  })

  it('falls back to a nested Vimeo playlist JSON when the config only exposes an adaptive playlist url', () => {
    const payload = JSON.stringify({
      video: {
        title: 'Aula privada',
        thumbs: {
          '640': 'https://i.vimeocdn.com/video/private-640.jpg',
        },
      },
      embed: {
        adaptive_url: 'https://skyfire.vimeocdn.com/1776436265-0x5da5e88c7dc1fabf29a3818f33614338b6c760a0/cac209c9-1a9e-43db-abcf-cdf74010c4c9/psid=b2804b41c2da1c4661fc5853c19557ad23d6d8c918ad7ba3c267386b4d6a4db4/v2/playlist/av/primary/prot/cXNyPTE/playlist.json?omit=av1-hevc',
      },
    })

    expect(
      resolveVimeoStreamDetails(
        payload,
        'https://player.vimeo.com/video/758870651/config?h=b8224b2ecc'
      )
    ).toEqual({
      canDownloadDash: false,
      canDownloadDirect: false,
      canDownloadHls: false,
      canDownloadVimeoPlaylist: true,
      isDrmProtected: false,
      options: [],
      selectedUrl: 'https://skyfire.vimeocdn.com/1776436265-0x5da5e88c7dc1fabf29a3818f33614338b6c760a0/cac209c9-1a9e-43db-abcf-cdf74010c4c9/psid=b2804b41c2da1c4661fc5853c19557ad23d6d8c918ad7ba3c267386b4d6a4db4/v2/playlist/av/primary/prot/cXNyPTE/playlist.json?omit=av1-hevc',
      selectedType: 'vimeo',
      thumbnailUrl: 'https://i.vimeocdn.com/video/private-640.jpg',
      title: 'Aula privada',
    })
  })

  it('ignores Vimeo progressive range fragments that are not a full downloadable file', () => {
    const payload = JSON.stringify({
      video: {
        title: 'Aula com fragmentos',
      },
      request: {
        files: {
          progressive: [
            {
              url: 'https://vod-adaptive-ak.vimeocdn.com/exp=1776442404~acl=%2Fclip%2F*~hmac=abc123/clip/v2/range/prot/cmFuZ2U9MzI3MTgxNy0zMzQ3Nzkw/avf/e9e37227-0290-4df3-a02d-24b7bf12b596.mp4?range=3271817-3347790',
              quality: '1080p',
              height: 1080,
            },
            {
              url: 'https://vod-progressive.akamaized.net/video/720p.mp4?token=abc',
              quality: '720p',
              height: 720,
            },
          ],
        },
      },
    })

    expect(
      resolveVimeoStreamDetails(
        payload,
        'https://player.vimeo.com/video/758870651/config?h=b8224b2ecc'
      )
    ).toEqual(
      expect.objectContaining({
        canDownloadDirect: true,
        options: [
          expect.objectContaining({
            quality: '720p',
            url: 'https://vod-progressive.akamaized.net/video/720p.mp4?token=abc',
          }),
        ],
        selectedType: 'progressive',
        selectedUrl: 'https://vod-progressive.akamaized.net/video/720p.mp4?token=abc',
      })
    )
  })

  it('flags Vimeo DRM payloads explicitly when no downloadable path is available', () => {
    const payload = JSON.stringify({
      request: {
        files: {
          dash: {
            cdns: {
              fastly_skyfire: {
                drm: true,
                url: 'https://vod-adaptive-ak.vimeocdn.com/private/master.mpd',
              },
            },
          },
          hls: {
            cdns: {
              fastly_skyfire: {
                drm: true,
              },
            },
          },
        },
      },
    })

    expect(
      resolveVimeoStreamDetails(
        payload,
        'https://player.vimeo.com/video/758870651/config?h=b8224b2ecc'
      )
    ).toEqual(
      expect.objectContaining({
        canDownloadDirect: false,
        canDownloadHls: false,
        canDownloadVimeoPlaylist: false,
        isDrmProtected: true,
        selectedType: 'drm',
      })
    )
  })
})