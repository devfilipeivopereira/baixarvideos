type Status = 'error' | 'success' | 'info'

interface Props {
  status: Status
  message: string
}

const styles: Record<Status, string> = {
  error: 'border border-red-300 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200',
  success: 'border border-green-300 bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200',
  info: 'border border-blue-300 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
}

export function StatusMessage({ status, message }: Props) {
  return (
    <div className={`rounded-md p-3 text-sm ${styles[status]}`}>
      {message}
    </div>
  )
}
