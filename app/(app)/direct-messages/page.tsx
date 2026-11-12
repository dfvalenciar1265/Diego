import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/auth'
import { getDirectMessagePlans } from '@/actions/direct-messages'
import { DirectMessagePlanner } from '@/components/direct-messages/DirectMessagePlanner'
export default async function DirectMessagesPage() {
 const member=await getCurrentMember()
 if (!member) redirect('/logout')
 if (member.role!=='admin') redirect('/')
 const result=await getDirectMessagePlans()
 return <main className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
  <Link href="/" className="text-sm underline">Volver a Inicio</Link>
  <h1 className="text-2xl font-bold">Mensajes de reservas directas</h1>
  <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><strong>Envíos automáticos desactivados.</strong> Aquí solo se guardan planes y borradores. No hay mensajes enviados ni entregas confirmadas. Antes de activar un canal faltan verificar destinatarios, aprobar plantillas y configurar un proveedor.</p>
  {!result.ok ? <p role="alert">{result.error}</p> : result.data.length===0 ? <p>No hay reservas directas actuales o futuras para planificar.</p> : <DirectMessagePlanner views={result.data} />}
 </main>
}
