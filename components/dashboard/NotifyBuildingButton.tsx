'use client'
import { useState, useTransition } from 'react'
import { useUserRole } from '@/lib/user-context'
import { setBuildingNotified } from '@/actions/tasks'
import { BUILDING_CONTACTS, buildGuestNotification, waLink, mailtoLink, type GuestNotifyData } from '@/lib/building-contacts'

/** ISO timestamp → "3:45pm" */
function to12h(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours(), m = d.getMinutes()
  const suffix = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`
}

interface Props {
  data: GuestNotifyData
  /** Prep task this arrival belongs to — where the "notified" mark is stored. */
  taskId: string
  /** When the building was notified, or null if not yet. */
  notifiedAt: string | null
}

/**
 * Admin-only "Avisar edificio" action. Prepares the guest-entry authorization and
 * opens WhatsApp (wa.me) or the mail app (mailto) with the message pre-filled —
 * the app never sends on its own; the admin reviews and taps Send. Opening the
 * message marks the arrival as announced so the home shows it in green.
 */
export function NotifyBuildingButton({ data, taskId, notifiedAt }: Props) {
  const role = useUserRole()
  const [open, setOpen]     = useState(false)
  const [sentAt, setSentAt] = useState<string | null>(notifiedAt)
  const [, startTransition] = useTransition()

  if (role !== 'admin') return null
  const contact = BUILDING_CONTACTS[data.apartment]
  if (!contact) return null   // no building contact configured for this apartment

  const msg = buildGuestNotification(data)
  const links = contact.method === 'whatsapp'
    ? contact.targets.map((num, i) => ({
        href:  waLink(num, msg.whatsappText),
        label: contact.targets.length > 1 ? `📱 Portero ${i + 1}` : '📱 WhatsApp',
      }))
    : contact.targets.map(email => ({
        href:  mailtoLink(email, msg.emailSubject, msg.emailBody),
        label: '📧 Correo',
      }))

  /** Opening the message counts as "announced" — persisted so it survives a reload. */
  function markSent() {
    const now = new Date().toISOString()
    setSentAt(now)                                   // instant feedback
    startTransition(async () => { await setBuildingNotified(taskId, true) })
  }
  function undo() {
    setSentAt(null)
    startTransition(async () => { await setBuildingNotified(taskId, false) })
  }

  const done = sentAt != null

  return (
    <div className="mt-2 pt-2 border-t border-[#f1f5f9]">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 text-[11px] font-semibold active:opacity-60
                    ${done ? 'text-[#16a34a]' : 'text-[#6366f1]'}`}
      >
        {done ? `✅ Edificio avisado · ${to12h(sentAt!)}` : '📨 Avisar edificio'}
        <span className="text-[9px]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {links.map((l, i) => (
            <a
              key={i}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={markSent}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border active:opacity-60
                          ${done
                            ? 'border-[#bbf7d0] text-[#16a34a] bg-[#f0fdf4]'
                            : 'border-[#c7d2fe] text-[#4f46e5] bg-[#eef2ff]'}`}
            >
              {l.label}
            </a>
          ))}
          {done && (
            <button
              onClick={undo}
              className="text-[10px] text-[#94a3b8] underline underline-offset-2 active:opacity-60"
            >
              Desmarcar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
