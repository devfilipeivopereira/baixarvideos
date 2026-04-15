import { Progress } from '@/components/ui/progress'

interface Props {
  percent: number
  message: string
}

export function ProgressBar({ percent, message }: Props) {
  return (
    <div className="space-y-2">
      <Progress value={percent} className="h-3" />
      <p className="text-sm text-muted-foreground text-center">{message}</p>
    </div>
  )
}
