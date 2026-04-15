import { createFFmpeg } from '@ffmpeg/ffmpeg'

export type ProgressCallback = (percent: number, message: string) => void

/** Zero-pads segment index for filesystem ordering (exported for tests). */
export function buildSegmentFilename(index: number): string {
  return `seg${String(index).padStart(5, '0')}.ts`
}

/** Builds the ffmpeg concat file content (exported for tests). */
export function buildConcatList(filenames: string[]): string {
  return filenames.map((f) => `file '${f}'`).join('\n')
}

/**
 * Downloads all HLS segments via the proxy, assembles them with ffmpeg.wasm,
 * and returns a Blob of the resulting MP4.
 */
export async function downloadHls(
  segmentUrls: string[],
  cookies: string,
  onProgress: ProgressCallback
): Promise<Blob> {
  onProgress(0, 'Carregando ffmpeg.wasm...')

  const ffmpeg = createFFmpeg({ log: false })
  await ffmpeg.load()

  const total = segmentUrls.length
  const filenames: string[] = []

  for (let i = 0; i < total; i++) {
    const url = segmentUrls[i]
    const filename = buildSegmentFilename(i)

    onProgress(Math.round((i / total) * 85), `Baixando segmento ${i + 1}/${total}...`)

    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, cookies }),
    })

    if (!response.ok) throw new Error(`Falha ao baixar segmento ${i + 1}: HTTP ${response.status}`)

    const buffer = await response.arrayBuffer()
    ffmpeg.FS('writeFile', filename, new Uint8Array(buffer))
    filenames.push(filename)
  }

  onProgress(87, 'Montando MP4...')

  ffmpeg.FS('writeFile', 'concat.txt', buildConcatList(filenames))
  await ffmpeg.run('-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'output.mp4')

  onProgress(98, 'Finalizando arquivo...')

  const data = ffmpeg.FS('readFile', 'output.mp4')
  return new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' })
}

/**
 * Triggers a browser file download for the given Blob.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
