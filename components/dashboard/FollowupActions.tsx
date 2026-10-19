'use client'
import { useState, useTransition } from 'react'
import { advanceSpecialRequest, markChargeCollected, type FollowupActionResult } from '@/actions/followups'
import { toast } from '@/components/ui/feedback'

/**
 * Botón que abre un campo obligatorio y confirma: cobrar exige la referencia; avisar, a quién;
 * dejar lista, quién lo confirmó. Nada se marca con un solo toque.
 */
function ConfirmWithText({ label, placeholder, okMessage, color, run }: {
  label: string
  placeholder: string
  okMessage: string
  color: string
  run: (text: string) => Promise<FollowupActionResult>
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [isPending, startTransition] = useTransition()

  function submit() {
    if (!text.trim()) return
    startTransition(async () => {
      try {
        const res = await run(text.trim())
        if (res.success) {
          toast.success(okMessage)
          setOpen(false)
          setText('')
        } else {
          toast.error(res.error)
        }
      } catch {
        toast.error('No se pudo guardar y no sé si quedó: recarga la página y revisa antes de repetir.')
      }
    })
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="min-h-9 text-xs font-semibold px-2.5 rounded-md border bg-white active:opacity-70"
        style={{ color, borderColor: color }}>
        {label}
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1.5 w-full mt-1">
      <input
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setOpen(false) }}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={300}
        className="flex-1 min-w-0 text-xs border border-[#cbd5e1] rounded-md px-2 py-1.5 bg-white"
      />
      <button type="button" onClick={submit} disabled={isPending || !text.trim()}
        className="min-h-9 text-xs font-semibold text-white px-2.5 rounded-md disabled:opacity-50"
        style={{ background: color }}>
        {isPending ? '…' : 'Guardar'}
      </button>
      <button type="button" onClick={() => setOpen(false)} aria-label="Cancelar"
        className="min-h-9 text-xs text-[#64748b] px-1.5">✕</button>
    </div>
  )
}

export function CollectChargeButton({ id, version }: { id: string; version: number }) {
  return (
    <ConfirmWithText
      label="✓ Cobrado"
      placeholder="Referencia o comprobante del pago"
      okMessage="Cobro registrado como recibido"
      color="#15803d"
      run={text => markChargeCollected(id, version, text)}
    />
  )
}

export function RequestButtons({ id, version, status }: { id: string; version: number; status: string }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {status === 'registered' && (
        <ConfirmWithText
          label="Avisé"
          placeholder="A quién y por dónde (ej. Ana por WhatsApp)"
          okMessage="Aviso registrado (aún no está lista)"
          color="#d97706"
          run={text => advanceSpecialRequest(id, version, 'notified', text)}
        />
      )}
      {(status === 'registered' || status === 'notified') && (
        <ConfirmWithText
          label="✓ Quedó lista"
          placeholder="Qué se verificó (ej. cuna armada y revisada)"
          okMessage="Solicitud confirmada como lista"
          color="#15803d"
          run={text => advanceSpecialRequest(id, version, 'ready', text)}
        />
      )}
    </div>
  )
}
