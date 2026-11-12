import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({save:vi.fn(),refresh:vi.fn()}))
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh})}))
vi.mock('@/actions/preventive-review',()=>({recordPreventiveReview:mocks.save}))
import {PreventiveReviewPanel} from '@/components/maintenance/PreventiveReviewPanel'
const parent={id:'parent-synthetic',property_id:'property-synthetic',title:'Aire sintético',notes:'Contexto antiguo, no diagnóstico',description:'Preventivo',priority:'scheduled',status:'open',next_due:'2027-01-01',cost:500}
const correctives=[{...parent,id:'corrective-synthetic',priority:'normal',title:'Reporte sintético'},{...parent,id:'other-synthetic',property_id:'different-synthetic',priority:'normal',title:'Otro apartamento'}]
afterEach(cleanup);beforeEach(()=>vi.clearAllMocks())
function mount(){render(<PreventiveReviewPanel data={{parents:[parent],reviews:[],correctives}}/>)}
function fill(disposition='no_action'){fireEvent.change(screen.getByLabelText('Referencia del fragmento revisado'),{target:{value:'nota-sintetica-2026'}});fireEvent.change(screen.getByLabelText('Decisión de esta revisión'),{target:{value:disposition}});fireEvent.change(screen.getByLabelText('Motivo y comprobación de la decisión'),{target:{value:'Revisión humana sintética sin falla comprobada'}});fireEvent.click(screen.getByRole('checkbox'))}
describe('revisión manual sin inferencia',()=>{
 it('no preselecciona decisión ni convierte notas al montar',()=>{mount();expect(screen.getByLabelText('Decisión de esta revisión')).toHaveValue('');expect(screen.getByRole('button')).toBeDisabled();expect(mocks.save).not.toHaveBeenCalled()})
 it('guarda no acción con snapshot exacto sin campos de actualización padre',async()=>{mount();fill();mocks.save.mockResolvedValue({ok:true,data:{}});fireEvent.click(screen.getByRole('button'));await waitFor(()=>expect(mocks.refresh).toHaveBeenCalled());expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({parent_snapshot:parent,disposition:'no_action',corrective_id:null,corrective_snapshot:null,expected_version:0}));expect(mocks.save.mock.calls[0][0]).not.toHaveProperty('next_due')})
 it('solo ofrece correctivos mismo apartamento, sin selección automática',()=>{mount();fill('link_existing');expect(screen.getByLabelText('Correctivo del mismo apartamento')).toHaveValue('');expect(screen.queryByRole('option',{name:/Otro apartamento/})).not.toBeInTheDocument();expect(screen.getByRole('button')).toBeDisabled()})
 it('reintento incierto conserva clave y cambiar decisión exige confirmar de nuevo',async()=>{mount();fill('create_report');mocks.save.mockResolvedValue({ok:false,error:'Resultado incierto'});fireEvent.click(screen.getByRole('button'));await screen.findByText('Resultado incierto');fireEvent.click(screen.getByRole('button'));await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(2));expect(mocks.save.mock.calls[0][0].request_key).toBe(mocks.save.mock.calls[1][0].request_key);fireEvent.change(screen.getByLabelText('Decisión de esta revisión'),{target:{value:'no_action'}});expect(screen.getByRole('checkbox')).not.toBeChecked()})
})
