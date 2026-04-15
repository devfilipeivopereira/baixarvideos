/**
 * Parses an HLS .m3u8 manifest and returns the list of segment paths/URLs.
 * Lines starting with # are comments/tags and are ignored.
 */
export function parseM3u8(manifest: string): string[] {
  return manifest
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

/**
 * Resolves relative segment paths against the manifest base URL.
 * Absolute URLs (starting with http) are returned unchanged.
 */
export function resolveSegmentUrls(segments: string[], baseUrl: string): string[] {
  const base = new URL(baseUrl)
  const baseDir = base.href.substring(0, base.href.lastIndexOf('/') + 1)

  return segments.map((seg) => {
    if (seg.startsWith('http')) return seg
    return baseDir + seg
  })
}
