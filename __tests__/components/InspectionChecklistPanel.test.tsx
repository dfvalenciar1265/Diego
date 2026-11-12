import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {InspectionChecklistPanel} from '@/components/inspection/InspectionChecklistPanel'
const mocks=vi.hoisted(()=>({save:vi.fn(),upload:vi.fn(),refresh:vi.fn()}))
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh})}))
vi.mock('@/actions/inspection',()=>({saveInspection:mocks.save,uploadInspectionPhoto:mocks.upload,inspectionPhotoUrl:vi.fn()}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
const stay={id:'00000000-0000-0000-0000-00000000ac21',property_id:'00000000-0000-0000-0000-00000000ac11',check_in:'2026-11-12',check_out:'2026-11-14',status:'confirmed'}
describe('checklist físico',()=>{
 it('no marca nada de antemano ni escribe al abrir',()=>{render(<InspectionChecklistPanel stay={stay} initial={null} canEdit/>);expect(screen.getAllByText('Sin revisar')).toHaveLength(5);expect(mocks.save).not.toHaveBeenCalled()})
 it('no permite editar fuera de la ventana',()=>{render(<InspectionChecklistPanel stay={stay} initial={null} canEdit={false}/>);expect(screen.queryByRole('button',{name:'Revisar este punto'})).not.toBeInTheDocument()})
 it('requiere descripción para incidencia',()=>{render(<InspectionChecklistPanel stay={stay} initial={null} canEdit/>);fireEvent.click(screen.getAllByRole('button',{name:'Revisar este punto'})[0]);fireEvent.change(screen.getByLabelText('Resultado'),{target:{value:'issue'}});expect(screen.getByRole('button',{name:'Registrar lo revisado'})).toBeDisabled()})
 it('no registra si subir la foto falla',async()=>{mocks.upload.mockResolvedValue({error:'No se guardó la foto.'});render(<InspectionChecklistPanel stay={stay} initial={null} canEdit/>);fireEvent.click(screen.getAllByRole('button',{name:'Revisar este punto'})[0]);fireEvent.change(screen.getByLabelText(/Foto privada opcional/),{target:{files:[new File(['bad'],'test.jpg',{type:'image/jpeg'})]}});fireEvent.click(screen.getByRole('button',{name:'Registrar lo revisado'}));await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('No se guardó la foto.'));expect(mocks.save).not.toHaveBeenCalled()})
 it('no afirma guardado ante conflicto',async()=>{mocks.save.mockResolvedValue({ok:false,error:'Otra persona actualizó el checklist.'});render(<InspectionChecklistPanel stay={stay} initial={null} canEdit/>);fireEvent.click(screen.getAllByRole('button',{name:'Revisar este punto'})[0]);fireEvent.click(screen.getByRole('button',{name:'Registrar lo revisado'}));await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Otra persona actualizó'));expect(screen.getAllByText('Sin revisar')).toHaveLength(5)})
})
