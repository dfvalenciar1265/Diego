import {describe,it,expect} from 'vitest'
import {directContactInput,persistDirectContact} from '@/lib/direct-contact'
import {fakeDb} from '../../helpers/fake-db'
function form(phone='+1 (555) 555-0123'){const f=new FormData();for(const[k,v]of Object.entries({source:'direct',guest_phone:phone,contact_version:'0',contact_request_key:'key'}))f.set(k,v);return f}
describe('contacto privado directa',()=>{
 it('normaliza sin inventar país y exige número internacional',()=>{expect(directContactInput(form())).toEqual({phone:'+15555550123',version:0,key:'key'});expect(directContactInput(form('3001234567'))).toHaveProperty('error');expect(directContactInput(form(''))).toEqual({phone:'',version:0,key:'key'})})
 it('Airbnb o formulario sin contacto no lo modifica',()=>{const f=form();f.set('source','airbnb');expect(directContactInput(f)).toHaveProperty('error');expect(directContactInput(new FormData())).toBeNull()})
 it('falla parcial indica editar la reserva guardada sin duplicarla',async()=>expect(await persistDirectContact(fakeDb({}),'id',directContactInput(form()))).toContain('No crees otra reserva'))
 it('relee teléfono, versión y actor antes de confirmar',async()=>{const row={reservation_id:'id',phone:'+15555550123',version:1,updated_by:'admin',updated_at:'2026-11-12T00:00:00Z'};const rpc=()=>({data:{ok:true,data:row},error:null});expect(await persistDirectContact(fakeDb({direct_reservation_contacts:[row]},{rpc}),'id',directContactInput(form()))).toBeUndefined();expect(await persistDirectContact(fakeDb({direct_reservation_contacts:[{...row,version:2}]},{rpc}),'id',directContactInput(form()))).toContain('no se confirmó')})
})
