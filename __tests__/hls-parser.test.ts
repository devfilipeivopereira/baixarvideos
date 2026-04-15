import { parseM3u8, resolveSegmentUrls } from '@/lib/hls-parser'

const SIMPLE_M3U8 = `
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:9.0,
seg000.ts
#EXTINF:9.0,
seg001.ts
#EXT-X-ENDLIST
`

const ABSOLUTE_M3U8 = `
#EXTM3U
#EXTINF:9.0,
https://cdn.example.com/video/seg000.ts
#EXTINF:9.0,
https://cdn.example.com/video/seg001.ts
#EXT-X-ENDLIST
`

describe('parseM3u8', () => {
  it('extracts relative segment paths', () => {
    expect(parseM3u8(SIMPLE_M3U8)).toEqual(['seg000.ts', 'seg001.ts'])
  })

  it('extracts absolute segment URLs', () => {
    expect(parseM3u8(ABSOLUTE_M3U8)).toEqual([
      'https://cdn.example.com/video/seg000.ts',
      'https://cdn.example.com/video/seg001.ts',
    ])
  })

  it('returns empty array for empty manifest', () => {
    expect(parseM3u8('')).toEqual([])
  })
})

describe('resolveSegmentUrls', () => {
  it('resolves relative segments against base URL', () => {
    const baseUrl = 'https://cdn.example.com/video/index.m3u8'
    const segments = ['seg000.ts', 'seg001.ts']
    expect(resolveSegmentUrls(segments, baseUrl)).toEqual([
      'https://cdn.example.com/video/seg000.ts',
      'https://cdn.example.com/video/seg001.ts',
    ])
  })

  it('leaves absolute URLs unchanged', () => {
    const baseUrl = 'https://cdn.example.com/video/index.m3u8'
    const segments = ['https://other.cdn.com/seg000.ts']
    expect(resolveSegmentUrls(segments, baseUrl)).toEqual([
      'https://other.cdn.com/seg000.ts',
    ])
  })
})
