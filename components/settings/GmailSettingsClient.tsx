'use client'

import { useState, useTransition } from 'react'
import { Mail, CheckCircle, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react'
import { syncGmail } from '@/actions/gmail'
import { useRouter } from 'next/navigation'
import type { SyncResult } from '@/lib/gmail-reconciliation/types'
import type { GmailStatus } from '@/lib/gmail-reconciliation/status'
import { GmailReconciliation } from './GmailReconciliation'
import { gmailNotice } from '@/lib/gmail-reconciliation/presentation'

export function GmailSettingsClient(status: GmailStatus) {
  const {connected}=status
  const router=useRouter()
  const [isPending,startTransition]=useTransition()
  const [syncResult,setSyncResult]=useState<SyncResult|null>(null)
  const notice=syncResult?gmailNotice(syncResult):null

  function handleSync() {
    setSyncResult(null)
    startTransition(async () => {
      try {
        const result = await syncGmail()
        setSyncResult(result)
        router.refresh()
      } catch { setSyncResult({ok:false,state:'failed',error:'Resultado incierto. Actualiza conciliación antes de repetir.'}) }
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
                ? 'Conexión registrada; consulta la lectura y los pendientes abajo'
                : 'Conecta para importar reservas automáticamente'}
            </p>
          </div>
          {connected
            ? <CheckCircle size={18} className="ml-auto" style={{ color: '#16a34a' }} />
            : <AlertCircle size={18} className="ml-auto" style={{ color: '#dc2626' }} />
          }
        </div>
      </div>

      <GmailReconciliation status={status} />

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
      {notice && (
        <div
          role="status"
          className="rounded-xl p-3 text-sm"
          style={{
            background: notice.tone === 'success' ? '#dcfce7' : notice.tone === 'warning' ? '#fffbeb' : '#fef2f2',
            color: notice.tone === 'success' ? '#15803d' : notice.tone === 'warning' ? '#92400e' : '#dc2626',
          }}
        >
          {notice.message}
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
              <p>NEXT_PUBLIC_APP_URL=https://diegoprueba.vercel.app</p>
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
