'use client'

import { useState, useTransition } from 'react'
import { Mail, CheckCircle, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react'
import { syncGmail } from '@/actions/gmail'
import { formatDate } from '@/lib/utils'

interface Props {
  connected: boolean
  lastSync?: string
  lastNewCount?: number
}

export function GmailSettingsClient({ connected, lastSync, lastNewCount }: Props) {
  const [isPending, startTransition] = useTransition()
  const [syncResult, setSyncResult] = useState<{
    ok: boolean
    new_count?: number
    error?: string
  } | null>(null)

  function handleSync() {
    setSyncResult(null)
    startTransition(async () => {
      const result = await syncGmail()
      setSyncResult(result)
    })
  }

  return (
    <div className="space-y-4">

      {/* Connection status card */}
      <div className="bg-[var(--card)] rounded-2xl p-4 border border-[var(--border)]">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: connected ? '#dcfce7' : '#fef2f2' }}
          >
            <Mail size={20} style={{ color: connected ? '#16a34a' : '#dc2626' }} />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--text)]">
              {connected ? 'Gmail conectado' : 'Gmail no conectado'}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {connected
                ? 'Sincronización activa cada hora'
                : 'Conecta para importar reservas automáticamente'}
            </p>
          </div>
          {connected
            ? <CheckCircle size={18} className="ml-auto" style={{ color: '#16a34a' }} />
            : <AlertCircle size={18} className="ml-auto" style={{ color: '#dc2626' }} />
          }
        </div>

        {lastSync && (
          <div className="text-xs text-[var(--text-muted)] border-t border-[var(--border)] pt-3">
            Última sync: {formatDate(lastSync.slice(0, 10))}
            {lastNewCount !== undefined && ` · ${lastNewCount} reserva${lastNewCount !== 1 ? 's' : ''} nueva${lastNewCount !== 1 ? 's' : ''}`}
          </div>
        )}
      </div>

      {/* Connect / Reconnect button */}
      <a
        href="/api/gmail-auth"
        className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold border border-[var(--border)] text-[var(--text)] bg-[var(--card)]"
      >
        <ExternalLink size={16} />
        {connected ? 'Reconectar Gmail' : 'Conectar Gmail'}
      </a>

      {/* Manual sync button (only if connected) */}
      {connected && (
        <button
          onClick={handleSync}
          disabled={isPending}
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: '#ff385c' }}
        >
          <RefreshCw size={16} className={isPending ? 'animate-spin' : ''} />
          {isPending ? 'Sincronizando…' : 'Sincronizar ahora'}
        </button>
      )}

      {/* Sync result */}
      {syncResult && (
        <div
          className="rounded-xl p-3 text-sm"
          style={{
            background: syncResult.ok ? '#dcfce7' : '#fef2f2',
            color: syncResult.ok ? '#15803d' : '#dc2626',
          }}
        >
          {syncResult.ok
            ? syncResult.new_count === 0
              ? '✓ Todo al día — no hay reservas nuevas'
              : `✓ ${syncResult.new_count} reserva${syncResult.new_count !== 1 ? 's' : ''} importada${syncResult.new_count !== 1 ? 's' : ''}`
            : `Error: ${syncResult.error}`
          }
        </div>
      )}

      {/* Setup instructions (only if not connected) */}
      {!connected && (
        <div className="bg-[var(--card)] rounded-2xl p-4 border border-[var(--border)] space-y-3">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
            Requisitos para conectar
          </p>
          <div className="space-y-2 text-xs text-[var(--text-muted)]">
            <p>1. Configura las siguientes variables de entorno en Vercel:</p>
            <div className="bg-[var(--bg)] rounded-lg p-2 font-mono text-xs space-y-1">
              <p>GOOGLE_CLIENT_ID=...</p>
              <p>GOOGLE_CLIENT_SECRET=...</p>
              <p>NEXT_PUBLIC_APP_URL=https://tu-app.vercel.app</p>
              <p>CRON_SECRET=cadena-aleatoria-segura</p>
            </div>
            <p>2. En Google Cloud Console → APIs &amp; Services → Credentials,
              crea un OAuth 2.0 Client ID (Web application) y agrega
              <code className="bg-[var(--bg)] px-1 rounded mx-1">
                /api/gmail-auth/callback
              </code>
              como URI de redirección autorizado.
            </p>
            <p>3. Haz clic en &quot;Conectar Gmail&quot; arriba para completar el flujo.</p>
          </div>
        </div>
      )}
    </div>
  )
}
