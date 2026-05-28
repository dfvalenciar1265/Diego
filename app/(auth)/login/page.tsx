'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { lookupEmailByName } from '@/actions/team'

export default function LoginPage() {
  const router = useRouter()
  const [name,     setName]     = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      // 1. Look up the email for this name
      const result = await lookupEmailByName(name.trim())
      if (!result) {
        setError('No encontramos a nadie con ese nombre. Verifica cómo está registrado.')
        return
      }

      // 2. Sign in with the email + password
      const supabase = createClient()
      const { error: authError } = await supabase.auth.signInWithPassword({
        email:    result.email,
        password,
      })

      if (authError) {
        setError('Contraseña incorrecta. Intenta de nuevo.')
        return
      }

      router.push('/')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🏠</div>
          <h1 className="text-2xl font-bold text-[var(--text)]">AirAdmin</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">Gestión de apartamentos</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[var(--card)] rounded-2xl p-6 shadow-sm border border-[var(--border)] space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-[var(--text)] mb-1">
              Tu nombre
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              autoCapitalize="words"
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-[var(--primary)] bg-white"
              placeholder="Ana, Juan, María…"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[var(--text)] mb-1">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-[var(--primary)] bg-white"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[var(--primary)] text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-60 transition-opacity"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
