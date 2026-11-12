import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({save:vi.fn(),refresh:vi.fn()}))
vi.mock('@/actions/direct-messages',()=>({saveDirectDraft:mocks.save}))
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh})}))
import { DirectMessagePlanner } from '@/components/direct-messages/DirectMessagePlanner'
const view={reservation:{id:'r',property_id:'p',guest_name:'Sintético',guests:2,source:'direct',status:'confirmed',check_in:'2026-12-01',check_out:'2026-12-03',created_at:'2026-11-12T00:00:00Z'},apartment:'Sintético',drafts:[]}
afterEach(cleanup)
beforeEach(()=>vi.clearAllMocks())
describe('borradores directos sin envíos',()=>{
 it('no inventa contacto ni texto y requiere revisión humana',()=>{render(<DirectMessagePlanner views={[view]}/>);expect(screen.getAllByRole('button',{name:'Guardar borrador',hidden:true})[0]).toBeDisabled();expect(screen.getAllByLabelText('Contacto a comprobar')[0]).toHaveValue('');expect(screen.getAllByLabelText('Texto por revisar')[0]).toHaveValue('')})
 it('impide doble envío de guardado y reutiliza clave después de resultado incierto',async()=>{
  let finish!:(v:unknown)=>void;mocks.save.mockImplementationOnce(()=>new Promise(r=>{finish=r})).mockResolvedValue({ok:true})
  render(<DirectMessagePlanner views={[view]}/>);fireEvent.click(screen.getAllByRole('checkbox',{hidden:true})[0]);const button=screen.getAllByRole('button',{name:'Guardar borrador',hidden:true})[0];fireEvent.click(button);fireEvent.click(button);expect(mocks.save).toHaveBeenCalledTimes(1)
  finish({ok:false,error:'Resultado incierto'});await waitFor(()=>expect(button).not.toBeDisabled());fireEvent.click(button);await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(2));expect(mocks.save.mock.calls[0][0].request_key).toBe(mocks.save.mock.calls[1][0].request_key);expect(mocks.save.mock.calls[0][0].scheduled_for).toBeNull();await waitFor(()=>expect(mocks.refresh).toHaveBeenCalledTimes(1))
 })
 it('no permite planificar una reserva cancelada',()=>{render(<DirectMessagePlanner views={[{...view,reservation:{...view.reservation,status:'cancelled'}}]}/>);fireEvent.click(screen.getAllByRole('checkbox',{hidden:true})[0]);expect(screen.getAllByRole('button',{name:'Guardar borrador',hidden:true})[0]).toBeDisabled()})
})
