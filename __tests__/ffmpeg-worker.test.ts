import { buildConcatList, buildSegmentFilename } from '@/lib/ffmpeg-worker'

describe('buildSegmentFilename', () => {
  it('zero-pads index to 5 digits', () => {
    expect(buildSegmentFilename(0)).toBe('seg00000.ts')
    expect(buildSegmentFilename(42)).toBe('seg00042.ts')
    expect(buildSegmentFilename(99999)).toBe('seg99999.ts')
  })
})

describe('buildConcatList', () => {
  it('produces ffmpeg concat format', () => {
    const filenames = ['seg00000.ts', 'seg00001.ts']
    expect(buildConcatList(filenames)).toBe("file 'seg00000.ts'\nfile 'seg00001.ts'")
  })

  it('handles single segment', () => {
    expect(buildConcatList(['seg00000.ts'])).toBe("file 'seg00000.ts'")
  })
})
