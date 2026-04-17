import vimeoPlaylist from '../chrome-extension/vimeo-playlist.js'

const { appendBase64InitParam, resolvePlaylistDetails } = vimeoPlaylist

describe('chrome extension vimeo playlist helpers', () => {
  it('adds base64_init=1 to playlist urls when missing', () => {
    expect(
      appendBase64InitParam(
        'https://skyfire.vimeocdn.com/example/clip/v2/playlist/av/primary/playlist.json?omit=av1-hevc'
      )
    ).toBe(
      'https://skyfire.vimeocdn.com/example/clip/v2/playlist/av/primary/playlist.json?omit=av1-hevc&base64_init=1'
    )
  })

  it('extracts downloadable video options from Vimeo playlist JSON', () => {
    const playlistUrl =
      'https://skyfire.vimeocdn.com/1776437072-0xf06a261978e1c5a10899689e9abc0e3d07840912/cac209c9-1a9e-43db-abcf-cdf74010c4c9/psid=4fa78333bfb8cb5f05a6c853de6b8bc3073efe7885178f90c96c6a0cafe07242/v2/playlist/av/primary/playlist.json?omit=av1-hevc'

    const payload = JSON.stringify({
      clip_id: '758870651',
      video: [
        {
          id: 'b3ca45c4-36bf-4701-83a9-3fdd6a8f677a',
          width: 1280,
          height: 720,
          bitrate: 2400000,
          base_url: 'v2/remux/avf/b3ca45c4-36bf-4701-83a9-3fdd6a8f677a/',
          init_segment: 'AAAA',
          segments: [
            { url: 'segment-1.m4s?sid=1&st=video' },
          ],
        },
        {
          id: 'e9e37227-0290-4df3-a02d-24b7bf12b596',
          width: 1920,
          height: 1080,
          bitrate: 4200000,
          base_url: 'v2/remux/avf/e9e37227-0290-4df3-a02d-24b7bf12b596/',
          init_segment: 'BBBB',
          segments: [
            { url: 'segment-1.m4s?sid=1&st=video' },
            { url: 'segment-2.m4s?sid=2&st=video' },
          ],
        },
      ],
      audio: [
        {
          id: 'main-audio',
          bitrate: 128000,
          base_url: 'v2/remux/audio/main-audio/',
          init_segment: 'CCCC',
          segments: [
            { url: 'segment-1.m4s?sid=1&st=audio' },
          ],
        },
      ],
    })

    expect(resolvePlaylistDetails(payload, playlistUrl)).toEqual({
      options: [
        expect.objectContaining({
          type: 'vimeo-playlist',
          quality: '1080p',
          label: '1080p (Vimeo)',
          playlistUrl: playlistUrl,
          url: playlistUrl + '#video=e9e37227-0290-4df3-a02d-24b7bf12b596&audio=main-audio',
          videoTrack: expect.objectContaining({
            id: 'e9e37227-0290-4df3-a02d-24b7bf12b596',
            segments: [
              'https://skyfire.vimeocdn.com/1776437072-0xf06a261978e1c5a10899689e9abc0e3d07840912/cac209c9-1a9e-43db-abcf-cdf74010c4c9/psid=4fa78333bfb8cb5f05a6c853de6b8bc3073efe7885178f90c96c6a0cafe07242/v2/remux/avf/e9e37227-0290-4df3-a02d-24b7bf12b596/segment-1.m4s?sid=1&st=video',
              'https://skyfire.vimeocdn.com/1776437072-0xf06a261978e1c5a10899689e9abc0e3d07840912/cac209c9-1a9e-43db-abcf-cdf74010c4c9/psid=4fa78333bfb8cb5f05a6c853de6b8bc3073efe7885178f90c96c6a0cafe07242/v2/remux/avf/e9e37227-0290-4df3-a02d-24b7bf12b596/segment-2.m4s?sid=2&st=video',
            ],
          }),
          audioTrack: expect.objectContaining({
            id: 'main-audio',
            segments: [
              'https://skyfire.vimeocdn.com/1776437072-0xf06a261978e1c5a10899689e9abc0e3d07840912/cac209c9-1a9e-43db-abcf-cdf74010c4c9/psid=4fa78333bfb8cb5f05a6c853de6b8bc3073efe7885178f90c96c6a0cafe07242/v2/remux/audio/main-audio/segment-1.m4s?sid=1&st=audio',
            ],
          }),
        }),
        expect.objectContaining({
          type: 'vimeo-playlist',
          quality: '720p',
          label: '720p (Vimeo)',
        }),
      ],
      selectedType: 'vimeo-playlist',
      selectedUrl: playlistUrl + '#video=e9e37227-0290-4df3-a02d-24b7bf12b596&audio=main-audio',
    })
  })
})
