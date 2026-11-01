'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { dashboardDay } from '@/lib/dashboard-day'

export function RefreshButton({ dayKey }: { dayKey?: string }) {
  const router = useRouter()
  const [spinning, setSpinning] = useState(false)

  useEffect(() => {
    if (!dayKey) return
    let timer: ReturnType<typeof setTimeout>
    let lastRefresh = 0
    function checkDay() {
      clearTimeout(timer)
      const now = new Date()
      const current = dashboardDay(now)
      const changed = current.key !== dayKey
      const editing = document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')
        || document.querySelector('textarea:disabled,select:disabled,[data-home-edit-error="true"]')
      if (changed && !editing && document.visibilityState !== 'hidden' && now.getTime() - lastRefresh > 1000) {
        lastRefresh = now.getTime()
        router.refresh()
      }
      timer = setTimeout(checkDay, changed && editing ? 1000 : Math.max(100, current.nextChangeAt - now.getTime() + 50))
    }
    checkDay()
    window.addEventListener('focus', checkDay)
    window.addEventListener('online', checkDay)
    document.addEventListener('visibilitychange', checkDay)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', checkDay)
      window.removeEventListener('online', checkDay)
      document.removeEventListener('visibilitychange', checkDay)
    }
  }, [dayKey, router])

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
