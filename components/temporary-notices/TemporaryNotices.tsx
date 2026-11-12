'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveTemporaryNotice } from '@/actions/temporary-notices'
import { noticeNeedsReview, type TemporaryNotice } from '@/lib/temporary-notices'

export function TemporaryNotices({ notices, properties, today, admin }: { notices: TemporaryNotice[]; properties: { id: string; name: string }[]; today: string; admin: boolean }) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ input: object; key: string; version: number } | null>(null)
  async function save(input: object, version: number) {
    const request = { input, key: crypto.randomUUID(), version }
    setPending(request); await execute(request)
  }
  async function execute(request: { input: object; key: string; version: number }) {
    setBusy(true); setError('')
    try {
      const result = await saveTemporaryNotice(request.input, request.key, request.version)
      if (!result.ok) { setError(result.error ?? 'No confirmado.'); return }
      setPending(null); router.refresh()
    } catch { setError('Resultado incierto. Reintenta la misma operación o actualiza antes de otro cambio.') }
    finally { setBusy(false) }
  }
  return <div className="space-y-4 p-4 max-w-3xl mx-auto">
    <p className="text-sm">Registro interno: no publica ni retira textos en Airbnb. Al vencer, recuerda revisar todas las ubicaciones; no supone que la piscina o servicio ya funciona.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {pending && <div className="border p-3"><p>Operación sin confirmar. No crees otro aviso para repetirla.</p><button disabled={busy} onClick={() => execute(pending)}>Reintentar el mismo cambio</button><button disabled={busy} onClick={() => { setPending(null); router.refresh() }}>Consultar de nuevo</button></div>}
    {notices.map(n => <article key={n.id} className="border rounded-xl p-4 space-y-2">
      <h2 className="font-semibold">{properties.find(p => p.id === n.property_id)?.name ?? 'Apartamento'} · {n.title}</h2>
      <p className="whitespace-pre-wrap break-words">{n.message}</p>
      <p>Revisar después del {n.expires_on}: <strong>{n.status === 'retired' ? 'Retiro verificado' : noticeNeedsReview(n, today) ? 'Vencido: revisar y retirar donde corresponda' : 'Vigente, pendiente de revisión'}</strong></p>
      <ul className="list-disc pl-5">{n.locations.map((l, i) => <li className="break-words" key={i}>{l}</li>)}</ul>
      {n.evidence && <p className="text-sm">Comprobación: {n.evidence}</p>}
      {admin && n.status === 'open' && <form onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget); void save({ ...n, status: 'retired', evidence: d.get('evidence') }, n.version) }}>
        <label className="block text-sm">Evidencia de retiro en todas las ubicaciones <input name="evidence" required minLength={10} maxLength={500} className="block border rounded w-full p-2" /></label>
        <button disabled={busy || !!pending} className="mt-2 border p-2 rounded">Confirmar retiro comprobado</button>
      </form>}
    </article>)}
    {!notices.length && <p>No hay avisos registrados.</p>}
    {admin && <form className="border rounded-xl p-4 space-y-3" onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget); void save({ property_id: d.get('property_id'), title: d.get('title'), message: d.get('message'), expires_on: d.get('expires_on'), locations: String(d.get('locations')).split('\n').map(x => x.trim()).filter(Boolean), status: 'open' }, 0) }}>
      <h2 className="font-semibold">Registrar aviso temporal</h2>
      <label className="block">Apartamento<select required name="property_id" className="block border p-2 w-full"><option value="">Selecciona</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="block">Título<input required name="title" minLength={3} maxLength={150} className="block border p-2 w-full" /></label>
      <label className="block">Texto vigente<textarea required name="message" maxLength={2000} className="block border p-2 w-full" /></label>
      <label className="block">Último día de vigencia<input required type="date" name="expires_on" className="block border p-2" /></label>
      <label className="block">Dónde se publicó, una ubicación por línea<textarea required name="locations" placeholder={'Manual de llegada, español\nManual de llegada, inglés\nDescripción del anuncio'} className="block border p-2 w-full" /></label>
      <p className="text-xs">No incluyas documentos, datos privados de huéspedes ni claves.</p>
      <button disabled={busy || !!pending} className="border rounded p-2">Guardar registro interno</button>
    </form>}
  </div>
}
