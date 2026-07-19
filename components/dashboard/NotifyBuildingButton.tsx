'use client'
import { useState } from 'react'
import { useUserRole } from '@/lib/user-context'
import { BUILDING_CONTACTS, buildGuestNotification, waLink, mailtoLink, type GuestNotifyData } from '@/lib/building-contacts'

/**
 * Admin-only "Avisar edificio" action. Prepares the guest-entry authorization and
 * opens WhatsApp (wa.me) or the mail app (mailto) with the message pre-filled —
 * the app never sends on its own; the admin reviews and taps Send.
 */
export function NotifyBuildingButton({ data }: { data: GuestNotifyData }) {
  const role = useUserRole()
  const [open, setOpen] = useState(false)

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

  return (
    <div className="mt-2 pt-2 border-t border-[#f1f5f9]">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[11px] font-semibold text-[#6366f1] active:opacity-60"
      >
        📨 Avisar edificio <span className="text-[9px]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {links.map((l, i) => (
            <a
              key={i}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-[#c7d2fe]
                         text-[#4f46e5] bg-[#eef2ff] active:opacity-60"
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
