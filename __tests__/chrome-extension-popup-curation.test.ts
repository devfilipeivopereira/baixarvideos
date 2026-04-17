import popupCuration from '../chrome-extension/popup-curation.js'

const { curateResolvedItems } = popupCuration

describe('chrome extension popup curation', () => {
  it('keeps only downloadable items and derives the real max resolution', () => {
    const items = curateResolvedItems([
      {
        details: {
          canDownloadHls: true,
          options: [
            { height: 720, label: '720p', quality: '720p', type: 'hls', url: 'https://cdn.example.com/720.m3u8' },
            { height: 1080, label: '1080p', quality: '1080p', type: 'hls', url: 'https://cdn.example.com/1080.m3u8' },
          ],
          selectedType: 'hls',
          selectedUrl: 'https://cdn.example.com/1080.m3u8',
          thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
          title: 'Video real',
        },
        stream: {
          timestamp: 100,
          type: 'vimeo',
          url: 'https://player.vimeo.com/video/123/config?h=abc',
        },
      },
      {
        details: {
          blockReason: 'Conteudo protegido por DRM',
          canDownloadDirect: false,
          canDownloadHls: false,
          canDownloadVimeoPlaylist: false,
          isDrmProtected: true,
          options: [],
          selectedType: 'drm',
          selectedUrl: 'https://cdn.example.com/drm.mpd',
          thumbnailUrl: 'https://cdn.example.com/thumb-drm.jpg',
          title: 'Video protegido',
        },
        stream: {
          timestamp: 200,
          type: 'drm',
          url: 'https://cdn.example.com/drm.mpd',
        },
      },
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toEqual(
      expect.objectContaining({
        mode: 'hls',
        modeLabel: 'HLS',
        resolutionLabel: '1080p',
        title: 'Video real',
      })
    )
  })

  it('deduplicates the same resolved video and keeps the stronger downloadable variant', () => {
    const items = curateResolvedItems([
      {
        details: {
          canDownloadHls: true,
          options: [
            { height: 720, label: '720p', quality: '720p', type: 'hls', url: 'https://cdn.example.com/720.m3u8' },
          ],
          selectedType: 'hls',
          selectedUrl: 'https://cdn.example.com/720.m3u8',
          thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
          title: 'Mesmo video',
        },
        stream: {
          timestamp: 100,
          type: 'vimeo',
          url: 'https://player.vimeo.com/video/123/config?h=abc',
        },
      },
      {
        details: {
          canDownloadDirect: true,
          options: [
            { height: 1080, label: '1080p (MP4)', quality: '1080p', type: 'progressive', url: 'https://cdn.example.com/1080.mp4' },
          ],
          selectedType: 'progressive',
          selectedUrl: 'https://cdn.example.com/1080.mp4',
          thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
          title: 'Mesmo video',
        },
        stream: {
          timestamp: 200,
          type: 'vimeo',
          url: 'https://skyfire.vimeocdn.com/path/to/playlist.json',
        },
      },
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toEqual(
      expect.objectContaining({
        mode: 'direct',
        resolutionLabel: '1080p',
        title: 'Mesmo video',
      })
    )
    expect(items[0].details).toEqual(
      expect.objectContaining({
        canDownloadDirect: true,
        selectedType: 'progressive',
      })
    )
  })

  it('filters out entries that only expose adaptive fragment URLs', () => {
    const items = curateResolvedItems([
      {
        details: {
          canDownloadDirect: true,
          options: [
            {
              height: 1080,
              label: '1080p (MP4)',
              quality: '1080p',
              type: 'progressive',
              url: 'https://vod-adaptive-ak.vimeocdn.com/clip/v2/range/prot/cmFuZ2U9MzI3MTgxNy0zMzQ3Nzkw/avf/file.mp4?range=3271817-3347790',
            },
          ],
          selectedType: 'progressive',
          selectedUrl: 'https://vod-adaptive-ak.vimeocdn.com/clip/v2/range/prot/cmFuZ2U9MzI3MTgxNy0zMzQ3Nzkw/avf/file.mp4?range=3271817-3347790',
          thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
          title: 'Fragmento parcial',
        },
        stream: {
          timestamp: 100,
          type: 'progressive',
          url: 'https://vod-adaptive-ak.vimeocdn.com/clip/v2/range/prot/cmFuZ2U9MzI3MTgxNy0zMzQ3Nzkw/avf/file.mp4?range=3271817-3347790',
        },
      },
    ])

    expect(items).toHaveLength(0)
  })
})