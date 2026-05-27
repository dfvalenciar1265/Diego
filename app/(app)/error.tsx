'use client'

import { useEffect } from 'react'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[AirAdmin error]', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
      <div className="text-4xl mb-4">⚠️</div>
      <h2 className="text-lg font-bold text-[#0f172a] mb-2">Algo salió mal</h2>
      <p className="text-sm text-[#94a3b8] mb-6 max-w-xs">
        {error.message || 'Ocurrió un error inesperado.'}
      </p>
      <button
        onClick={reset}
        className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
        style={{ background: '#ff385c' }}
      >
        Intentar de nuevo
      </button>
    </div>
  )
}
