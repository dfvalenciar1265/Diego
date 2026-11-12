import {describe,it,expect} from 'vitest'
import {directArrivalsTomorrow} from '@/lib/direct-arrivals'
import {fakeDb} from '../../helpers/fake-db'
const rows=[{id:'tomorrow',source:'direct',status:'confirmed',check_in:'2026-11-12'},{id:'today',source:'direct',status:'confirmed',check_in:'2026-11-11'},{id:'later',source:'direct',status:'confirmed',check_in:'2026-11-13'},{id:'cancel',source:'direct',status:'cancelled',check_in:'2026-11-12'},{id:'airbnb',source:'airbnb',status:'confirmed',check_in:'2026-11-12'},{id:'blocked',source:'direct',status:'blocked',check_in:'2026-11-12'}]
describe('aviso contextual de directas',()=>{
 it.each(['2026-11-11T14:00:00Z','2026-11-12T02:00:00Z'])('mañana Colombia, incluso después del corte nocturno %s',async(time)=>expect(await directArrivalsTomorrow(fakeDb({reservations:rows}),'admin',new Date(time))).toEqual({date:'2026-11-12',count:1}))
 it('no expone aviso al equipo ni muestra enlace vacío',async()=>{expect(await directArrivalsTomorrow(fakeDb({reservations:rows}),'cleaning')).toBeNull();expect(await directArrivalsTomorrow(fakeDb({reservations:[]}),'admin')).toBeNull()})
 it('falla sin afirmar cobertura si lectura falla',async()=>expect(await directArrivalsTomorrow(fakeDb({reservations:rows},{failSelectOnce:'reservations'}),'admin')).toBeNull())
})
