'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function RefreshButton() {
  const router = useRouter()
  const [spinning, setSpinning] = useState(false)

  function handleRefresh() {
    setSpinning(true)
    router.refresh()
    setTimeout(() => setSpinning(false), 800)
  }

  return (
    <button
      type="button"
      onClick={handleRefresh}
      title="Actualizar"
      aria-label="Actualizar datos"
      className="w-11 h-11 flex items-center justify-center rounded-full
                 text-[#64748b] hover:text-[#0f172a] hover:bg-[#f1f5f9]
                 active:scale-95 transition-all"
    >
      <svg
        width="18" height="18" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round"
        className={spinning ? 'animate-spin' : ''}
        style={{ animationDuration: '0.6s' }}
      >
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
    </button>
  )
}
