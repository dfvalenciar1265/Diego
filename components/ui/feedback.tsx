'use client'
/**
 * App-wide feedback: toasts after an action and a styled confirm dialog.
 *
 *   toast.success('Incidencia reportada')
 *   toast.error('No se guardó, reintenta')
 *   toast.success('Compra marcada', { action: { label: 'Deshacer', onClick: undo } })
 *
 *   const confirm = useConfirm()
 *   if (!(await confirm({ title: '¿Eliminar la reserva de Ana?', confirmLabel: 'Eliminar', danger: true }))) return
 *
 * Replaces the native window.confirm(), which looks broken in the iOS PWA.
 */
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { Toaster } from 'sonner'

export { toast } from 'sonner'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext)
  if (!fn) throw new Error('useConfirm must be used inside <FeedbackProvider>')
  return fn
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const [open, setOpen] = useState(false)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>(o => {
    resolver.current?.(false)            // a second confirm cancels the first
    setOpts(o)
    setOpen(true)
    return new Promise<boolean>(resolve => { resolver.current = resolve })
  }, [])

  function settle(ok: boolean) {
    resolver.current?.(ok)
    resolver.current = null
    setOpen(false)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      <AlertDialog.Root open={open} onOpenChange={o => { if (!o) settle(false) }}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop
            className="fixed inset-0 z-[60] bg-black/30 transition-opacity duration-150
                       data-ending-style:opacity-0 data-starting-style:opacity-0"
          />
          <AlertDialog.Popup
            className="fixed z-[61] left-4 right-4 top-1/2 -translate-y-1/2 mx-auto max-w-sm
                       rounded-2xl bg-white p-5 shadow-xl transition-all duration-150
                       data-ending-style:opacity-0 data-ending-style:scale-95
                       data-starting-style:opacity-0 data-starting-style:scale-95"
          >
            <AlertDialog.Title className="text-base font-semibold text-[var(--text)]">
              {opts?.title}
            </AlertDialog.Title>
            {opts?.description && (
              <AlertDialog.Description className="mt-1.5 text-sm text-[#64748b]">
                {opts.description}
              </AlertDialog.Description>
            )}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                autoFocus={!!opts?.danger}   // destructive: Enter must not delete
                onClick={() => settle(false)}
                className="flex-1 h-11 rounded-xl border border-[var(--border)] text-sm font-medium
                           text-[var(--text)] hover:bg-[var(--bg)] active:opacity-80"
              >
                {opts?.cancelLabel ?? 'Cancelar'}
              </button>
              <button
                type="button"
                autoFocus={!opts?.danger}
                onClick={() => settle(true)}
                className="flex-1 h-11 rounded-xl text-sm font-semibold text-white active:opacity-80"
                style={{ background: opts?.danger ? '#ef4444' : 'var(--primary)' }}
              >
                {opts?.confirmLabel ?? 'Confirmar'}
              </button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      {/* Above the phone bottom bar; bottom-right on desktop */}
      <Toaster
        position="bottom-right"
        richColors
        duration={3500}
        mobileOffset={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
        toastOptions={{ className: 'text-sm' }}
      />
    </ConfirmContext.Provider>
  )
}
