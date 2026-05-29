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
      onClick={handleRefresh}
      title="Actualizar"
      className="w-7 h-7 flex items-center justify-center rounded-full
                 text-[#94a3b8] hover:text-[#64748b] hover:bg-[#f1f5f9]
                 active:scale-95 transition-all"
    >
      <svg
        width="14" height="14" viewBox="0 0 24 24"
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
