import hls from '../chrome-extension/hls.js'
import hlsDownload from '../chrome-extension/hls-download.js'

const { parseManifest, resolvePlaylist } = hls
const { buildConcatList, buildSegmentFilename } = hlsDownload

describe('chrome extension hls helpers', () => {
  it('extracts sorted variants from a master manifest', () => {
    const manifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=854x480
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2560000,RESOLUTION=1280x720
mid/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5120000,RESOLUTION=1920x1080
high/index.m3u8
`

    expect(parseManifest(manifest, 'https://cdn.example.com/master.m3u8')).toEqual({
      kind: 'master',
      segments: [],
      variants: [
        expect.objectContaining({
          height: 1080,
          label: '1080p (HLS)',
          quality: '1080p',
          type: 'hls',
          url: 'https://cdn.example.com/high/index.m3u8',
          width: 1920,
        }),
        expect.objectContaining({
          height: 720,
          label: '720p (HLS)',
          quality: '720p',
          type: 'hls',
          url: 'https://cdn.example.com/mid/index.m3u8',
          width: 1280,
        }),
        expect.objectContaining({
          height: 480,
          label: '480p (HLS)',
          quality: '480p',
          type: 'hls',
          url: 'https://cdn.example.com/low/index.m3u8',
          width: 854,
        }),
      ],
    })
  })

  it('extracts media segments from a media playlist', () => {
    const manifest = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:5.0,
seg-1.ts
#EXTINF:5.0,
seg-2.ts
#EXT-X-ENDLIST
`

    expect(resolvePlaylist(manifest, 'https://cdn.example.com/video/main.m3u8')).toEqual({
      kind: 'media',
      segments: [
        'https://cdn.example.com/video/seg-1.ts',
        'https://cdn.example.com/video/seg-2.ts',
      ],
      variants: [],
    })
  })

  it('builds deterministic filenames and concat lists for ffmpeg', () => {
    expect(buildSegmentFilename(0)).toBe('seg00000.ts')
    expect(buildSegmentFilename(42)).toBe('seg00042.ts')
    expect(buildConcatList(['seg00000.ts', 'seg00001.ts'])).toBe("file 'seg00000.ts'\nfile 'seg00001.ts'")
  })
})
