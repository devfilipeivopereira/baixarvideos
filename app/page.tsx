import { DownloadForm } from '@/components/DownloadForm'

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-10 max-w-2xl">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-7 h-7 text-primary"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">BaixarHSL</h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Baixe vídeos HLS de sites autenticados direto para o seu PC —
            sem upload para servidores externos.
          </p>
        </div>

        {/* Step guide */}
        <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-8 flex-wrap">
          <StepBadge n={1} label="Login" />
          <Divider />
          <StepBadge n={2} label="Cookies" />
          <Divider />
          <StepBadge n={3} label="Navegar" />
          <Divider />
          <StepBadge n={4} label="Extrair" />
          <Divider />
          <StepBadge n={5} label="Baixar" />
        </div>

        <DownloadForm />

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-10">
          Uso pessoal · Cookies nunca são armazenados · Apenas HLS (.m3u8)
        </p>
      </div>
    </div>
  )
}

function StepBadge({ n, label }: { n: number; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/15 text-primary font-semibold text-[10px]">
        {n}
      </span>
      <span>{label}</span>
    </span>
  )
}

function Divider() {
  return <span className="text-border">──</span>
}
