import { DownloadForm } from '@/components/DownloadForm'

export default function Home() {
  return (
    <div className="container mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold tracking-tight mb-2">BaixarHSL</h1>
        <p className="text-muted-foreground">
          Baixe vídeos HLS (.m3u8) de sites autenticados direto para o seu PC
        </p>
      </div>
      <DownloadForm />
    </div>
  )
}
