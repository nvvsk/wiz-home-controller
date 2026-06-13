import { useEffect } from 'react'
import { CheckCircle, XCircle, AlertCircle, X } from 'lucide-react'

interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastProps {
  message: string
  type: 'success' | 'error' | 'warning'
  onClose: () => void
  duration?: number
  action?: ToastAction
}

export default function Toast({ message, type, onClose, duration = 3000, action }: ToastProps) {
  useEffect(() => {
    // If an action is offered, give the user longer to react.
    const effective = action ? Math.max(duration, 8000) : duration
    const timer = setTimeout(onClose, effective)
    return () => clearTimeout(timer)
  }, [duration, onClose, action])

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-green-500" />,
    error: <XCircle className="w-5 h-5 text-red-500" />,
    warning: <AlertCircle className="w-5 h-5 text-yellow-500" />
  }

  const bgColors = {
    success: 'bg-green-50 border-green-200',
    error: 'bg-red-50 border-red-200',
    warning: 'bg-yellow-50 border-yellow-200'
  }

  return (
    <div className={`fixed bottom-4 right-4 z-50 flex items-center space-x-3 px-4 py-3 rounded-lg border-2 shadow-lg ${bgColors[type]} animate-slide-up`}>
      {icons[type]}
      <p className="text-sm font-medium text-gray-900">{message}</p>
      {action && (
        <button
          onClick={() => { action.onClick(); onClose() }}
          className="text-sm font-semibold text-blue-600 hover:text-blue-800 underline"
        >
          {action.label}
        </button>
      )}
      <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
