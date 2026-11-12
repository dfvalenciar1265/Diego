import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/auth'
import { getProperties } from '@/actions/properties'
import { getPreventiveReviews } from '@/actions/preventive-review'
import { PreventiveReviewPanel } from '@/components/maintenance/PreventiveReviewPanel'
export default async function PreventiveReviewPage(){
 const member=await getCurrentMember()
 if(!member) redirect('/logout')
 if(member.role!=='admin') redirect('/maintenance')
 const [result,properties]=await Promise.all([getPreventiveReviews(),getProperties()])
 return <main className="mx-auto max-w-4xl space-y-4 p-4"><h1 className="text-xl font-bold">Revisión manual de notas preventivas</h1><p>Las notas son contexto histórico, no una lista de fallas comprobadas. Esta revisión no modifica fechas, estado ni costos del preventivo.</p>{result.ok?<PreventiveReviewPanel data={result.data} propertyNames={Object.fromEntries(properties.map(p=>[p.id,p.name]))}/>:<p role="alert">{result.error}</p>}</main>
}
