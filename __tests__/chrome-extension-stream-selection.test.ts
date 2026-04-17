import selection from '../chrome-extension/stream-selection.js'

const { sortStreamsForSelection } = selection

describe('chrome extension stream selection', () => {
  it('prefers Vimeo config urls over adaptive playlist json captures', () => {
    const streams = sortStreamsForSelection([
      {
        timestamp: 200,
        type: 'vimeo',
        url: 'https://skyfire.vimeocdn.com/path/to/playlist.json?omit=av1-hevc',
      },
      {
        timestamp: 100,
        type: 'vimeo',
        url: 'https://player.vimeo.com/video/758870651/config?h=b8224b2ecc',
      },
    ])

    expect(streams[0]).toEqual(
      expect.objectContaining({
        url: 'https://player.vimeo.com/video/758870651/config?h=b8224b2ecc',
      })
    )
  })

  it('prefers directly usable stream types ahead of dash fallbacks', () => {
    const streams = sortStreamsForSelection([
      {
        timestamp: 300,
        type: 'dash',
        url: 'https://cdn.example.com/manifest.mpd',
      },
      {
        timestamp: 100,
        type: 'hls',
        url: 'https://cdn.example.com/master.m3u8',
      },
    ])

    expect(streams[0]).toEqual(
      expect.objectContaining({
        type: 'hls',
        url: 'https://cdn.example.com/master.m3u8',
      })
    )
  })

  it('does not prioritize Vimeo range fragments ahead of the real Vimeo config', () => {
    const streams = sortStreamsForSelection([
      {
        timestamp: 300,
        type: 'progressive',
        url: 'https://vod-adaptive-ak.vimeocdn.com/exp=1776437241~acl=%2Fclip%2F*~hmac=abc123/clip/v2/range/prot/cmFuZ2U9NjcyMDA4My02OTEwMzY1/avf/e9e37227-0290-4df3-a02d-24b7bf12b596.mp4?pathsig=8c953e4f~token&r=dXMtY2VudHJhbDE%3D&range=6720083-6910365',
      },
      {
        timestamp: 100,
        type: 'vimeo',
        url: 'https://player.vimeo.com/video/758870651/config?h=b8224b2ecc',
      },
    ])

    expect(streams[0]).toEqual(
      expect.objectContaining({
        type: 'vimeo',
        url: 'https://player.vimeo.com/video/758870651/config?h=b8224b2ecc',
      })
    )
  })
})
