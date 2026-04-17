import diagnostics from '../chrome-extension/diagnostics.js'

const {
  createDiagnosticsState,
  applyDiagnosticsEvent,
} = diagnostics

describe('chrome extension diagnostics state', () => {
  it('tracks lifecycle, network events and last detected stream for a tab', () => {
    let state = createDiagnosticsState(42)

    state = applyDiagnosticsEvent(state, {
      kind: 'content-loaded',
      source: 'content',
      pageUrl: 'https://ead.envisionar.com/course/lesson',
      ts: 10,
    })
    state = applyDiagnosticsEvent(state, {
      kind: 'interceptor-loaded',
      source: 'interceptor',
      pageUrl: 'https://ead.envisionar.com/course/lesson',
      ts: 20,
    })
    state = applyDiagnosticsEvent(state, {
      kind: 'network-request',
      source: 'background',
      url: 'https://player.vimeo.com/video/123/config',
      ts: 30,
    })
    state = applyDiagnosticsEvent(state, {
      kind: 'network-response',
      source: 'background',
      url: 'https://player.vimeo.com/video/123/config',
      detail: 'application/json',
      ts: 40,
    })
    state = applyDiagnosticsEvent(state, {
      kind: 'stream-found',
      source: 'interceptor',
      url: 'https://vod-adaptive-ak.vimeocdn.com/video/master.m3u8',
      streamType: 'hls',
      ts: 50,
    })

    expect(state.contentScriptSeen).toBe(true)
    expect(state.interceptorSeen).toBe(true)
    expect(state.pageUrl).toBe('https://ead.envisionar.com/course/lesson')
    expect(state.lastRequestUrl).toBe('https://player.vimeo.com/video/123/config')
    expect(state.lastResponseUrl).toBe('https://player.vimeo.com/video/123/config')
    expect(state.lastManifestUrl).toBe('https://vod-adaptive-ak.vimeocdn.com/video/master.m3u8')
    expect(state.lastManifestType).toBe('hls')
    expect(state.counts.requestsSeen).toBe(1)
    expect(state.counts.responsesSeen).toBe(1)
    expect(state.counts.streamsFound).toBe(1)
    expect(state.events).toHaveLength(5)
  })

  it('keeps only the newest 50 events and increments error count', () => {
    let state = createDiagnosticsState(7)

    for (let index = 1; index <= 55; index += 1) {
      state = applyDiagnosticsEvent(state, {
        kind: index === 55 ? 'error' : 'network-request',
        source: 'background',
        url: `https://example.com/request-${index}`,
        detail: index === 55 ? 'failed to inspect response body' : '',
        ts: index,
      })
    }

    expect(state.counts.requestsSeen).toBe(54)
    expect(state.counts.errors).toBe(1)
    expect(state.lastError).toBe('failed to inspect response body')
    expect(state.events).toHaveLength(50)
    const firstEvent = state.events[0] as { ts: number }
    const lastEvent = state.events[49] as { ts: number }
    expect(firstEvent.ts).toBe(6)
    expect(lastEvent.ts).toBe(55)
  })
})
