import {describe,it,expect} from 'vitest'
import {checkoutPrompts,type CheckSource,type CheckStay,type CheckoutPrompt} from '@/lib/checkout-checks'
const source:CheckSource={id:'issue',property_id:'property',title:'Faltan platos, cantidad por comprobar',status:'open',priority:'normal',fingerprint:'hash'}
const stay:CheckStay={id:'stay',property_id:'property',check_in:'2026-11-10',check_out:'2026-11-12'}
const prompt:CheckoutPrompt={id:'prompt',source_id:source.id,property_id:source.property_id,source_snapshot:source,instruction:'Contar platos disponibles'}
describe('avisos de salida explícitos',()=>{
 it('no inventa aviso por existir reporte ni cantidad',()=>{expect(checkoutPrompts([], [source],[],stay)).toEqual([]);expect(JSON.stringify(checkoutPrompts([prompt],[source],[],stay))).not.toContain('2 platos')})
 it('selección más reciente sustituye visualmente sin borrar historial',()=>{const old={...prompt,id:'old',instruction:'Instrucción anterior'};expect(checkoutPrompts([prompt,old],[source],[],stay)).toHaveLength(1);expect(checkoutPrompts([prompt,old],[source],[],stay)[0].instruction).toBe(prompt.instruction)})
 it('excluye preventivo/resuelto/otra propiedad',()=>{for(const patch of [{priority:'scheduled'},{status:'resolved'},{property_id:'other'}])expect(checkoutPrompts([prompt],[{...source,...patch}],[],stay)).toEqual([])})
 it('cambio de descripción detectado por hash requiere revisión',()=>{expect(checkoutPrompts([prompt],[{...source,fingerprint:'new'}],[],stay)[0].stale).toBe(true)})
 it('omisión solo vale para misma salida y fuente',()=>{const skip={id:'skip',prompt_id:'prompt',stay_snapshot:stay,source_snapshot:source,reason:'Sin acceso',author:'Limpieza',created_at:'now'};expect(checkoutPrompts([prompt],[source],[skip],stay)[0].skipped).toEqual(skip);expect(checkoutPrompts([prompt],[source],[skip],{...stay,check_out:'2026-11-13'})[0].skipped).toBeUndefined()})
})
