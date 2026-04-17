import fs from 'node:fs'
import path from 'node:path'

const extensionDir = path.join(process.cwd(), 'chrome-extension')

function readExtensionFile(fileName: string) {
  return fs.readFileSync(path.join(extensionDir, fileName), 'utf8')
}

describe('chrome extension capture wiring', () => {
  it('registers the interceptor directly as a main-world content script', () => {
    const manifest = JSON.parse(readExtensionFile('manifest.json')) as {
      content_scripts?: Array<Record<string, unknown>>
    }

    expect(manifest.content_scripts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          js: ['interceptor-detector.js', 'interceptor.js'],
          run_at: 'document_start',
          world: 'MAIN',
          match_about_blank: true,
          match_origin_as_fallback: true,
        }),
      ])
    )
  })

  it('keeps the bridge content script free from DOM-based script injection', () => {
    const contentScript = readExtensionFile('content.js')

    expect(contentScript).not.toContain("chrome.runtime.getURL('interceptor.js')")
    expect(contentScript).not.toContain('document.createElement(\'script\')')
    expect(contentScript).not.toContain('appendChild(s)')
  })

  it('includes popup debug controls and active-tab access for diagnostics', () => {
    const manifest = JSON.parse(readExtensionFile('manifest.json')) as {
      permissions?: string[]
    }
    const popupHtml = readExtensionFile('popup.html')
    const popupScript = readExtensionFile('popup.js')

    expect(manifest.permissions).toEqual(expect.arrayContaining(['tabs']))
    expect(popupHtml).toContain('id="btnDebugToggle"')
    expect(popupHtml).toContain('id="debugPanel"')
    expect(popupHtml).toContain('id="btnCopyDebug"')
    expect(popupScript).toContain("chrome.tabs.query({ active: true, currentWindow: true }")
  })

  it('ships popup download controls for an extension-only flow', () => {
    const popupHtml = readExtensionFile('popup.html')
    const popupScript = readExtensionFile('popup.js')
    const manifest = JSON.parse(readExtensionFile('manifest.json')) as {
      permissions?: string[]
    }

    expect(manifest.permissions).toEqual(expect.arrayContaining(['downloads']))
    expect(popupHtml).toContain('id="previewImage"')
    expect(popupHtml).toContain('id="previewTitle"')
    expect(popupHtml).toContain('id="qualitySelect"')
    expect(popupHtml).toContain('id="btnPrimaryAction"')
    expect(popupHtml).toContain('id="btnCopyUrl"')
    expect(popupScript).toContain("action: 'resolveStreamDetails'")
    expect(popupScript).toContain("action: 'downloadResolvedStream'")
    expect(popupScript).toContain('chrome.downloads')
    expect(popupScript).toContain('Baixando segmentos')
    expect(popupScript).toContain("type === 'hls'")
    expect(popupScript).toContain("type === 'vimeo-playlist'")
    expect(popupScript).toContain('converter o stream para MP4')
    expect(popupScript).toContain('downloadSelectedHlsStream')
    expect(popupScript).toContain('downloadSelectedVimeoPlaylistStream')
    expect(popupScript).toContain('canDownloadVimeoPlaylist')
    expect(popupScript).toContain('curateResolvedItems')
    expect(popupScript).toContain('Nenhum video baixavel encontrado nesta aba')
    expect(popupHtml).toContain('src="vimeo-playlist.js"')
    expect(popupHtml).toContain('src="popup-curation.js"')
    expect(popupScript).not.toContain('onclick="')
    expect(popupScript).not.toContain('appBaseUrl')
    expect(popupScript).not.toContain(
      'Este stream foi detectado como HLS. Download direto ainda nao esta disponivel para este formato na extensao.'
    )
  })

  it('adds SPA navigation and performance-based observation to the main-world interceptor', () => {
    const interceptorScript = readExtensionFile('interceptor.js')
    const contentScript = readExtensionFile('content.js')

    expect(interceptorScript).toContain('PerformanceObserver')
    expect(interceptorScript).toContain('history.pushState')
    expect(interceptorScript).toContain('history.replaceState')
    expect(contentScript).toContain('navigation')
  })

  it('adds universal media detection and explicit DRM signalling', () => {
    const contentScript = readExtensionFile('content.js')
    const interceptorScript = readExtensionFile('interceptor.js')
    const popupScript = readExtensionFile('popup.js')
    const backgroundScript = readExtensionFile('background.js')

    expect(contentScript).toContain("querySelectorAll('video')")
    expect(contentScript).toContain("querySelectorAll('source')")
    expect(contentScript).toContain('__baixarhsl_drm__')
    expect(contentScript).toContain('__baixarhsl_media_source__')
    expect(interceptorScript).toContain('requestMediaKeySystemAccess')
    expect(interceptorScript).toContain('setMediaKeys')
    expect(interceptorScript).toContain('MediaSource')
    expect(interceptorScript).toContain('createObjectURL')
    expect(popupScript).toContain('Conteudo protegido por DRM')
    expect(popupScript).toContain('Fragmento adaptativo detectado')
    expect(popupScript).toContain('isPartialMediaFragmentUrl(downloadUrl)')
    expect(backgroundScript).toContain('canDownloadHls')
    expect(backgroundScript).toContain('canDownloadDash')
    expect(backgroundScript).toContain("resolveStreamDetails")
  })
})
