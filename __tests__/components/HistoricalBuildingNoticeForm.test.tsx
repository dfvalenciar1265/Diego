import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({save:vi.fn()}))
vi.mock('@/actions/building-notices',()=>({recordHistoricalBuildingNotice:mocks.save}))
import {HistoricalBuildingNoticeForm} from '@/components/dashboard/HistoricalBuildingNoticeForm'
import {buildingView,buildingIds as ids} from '../helpers/building-notices'
import {noticeSnapshot} from '@/lib/building-notices'
afterEach(cleanup);beforeEach(()=>vi.clearAllMocks())
const view=buildingView()
function open(){const reload=vi.fn().mockResolvedValue(undefined);render(<HistoricalBuildingNoticeForm reservationId={ids.reservation} snapshot={noticeSnapshot(view,view.recipients[0])} reload={reload}/>);fireEvent.click(screen.getByText('Registrar un aviso enviado anteriormente'));return reload}
function fill(){fireEvent.change(screen.getByLabelText('Hecho histórico comprobado'),{target:{value:'delivered'}});fireEvent.change(screen.getByLabelText('Cuándo ocurrió · Colombia'),{target:{value:'2026-11-01T07:30'}});fireEvent.change(screen.getByLabelText('Referencia única del mensaje o comprobante'),{target:{value:'synthetic-ref'}});fireEvent.change(screen.getByLabelText('Evidencia histórica (10–500 caracteres)'),{target:{value:'Comprobante sintético de entrega'}});fireEvent.click(screen.getByRole('checkbox'))}
describe('formulario histórico',()=>{
 it('no inventa hora y exige confirmación; usa -05 y relee antes de éxito',async()=>{const reload=open();expect(screen.getByLabelText('Cuándo ocurrió · Colombia')).toHaveValue('');expect(screen.getByRole('button')).toBeDisabled();fill();mocks.save.mockResolvedValue({ok:true,data:{invalidated_at:null}});fireEvent.click(screen.getByRole('button'));await waitFor(()=>expect(reload).toHaveBeenCalledOnce());expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({status:'delivered',occurred_at:'2026-11-01T07:30:00-05:00',expected_version:0,confirmed:true}));expect(await screen.findByRole('status')).toHaveTextContent('No se envió ningún mensaje')})
 it('reintenta con misma clave solo mientras contenido no cambie',async()=>{open();fill();mocks.save.mockResolvedValue({ok:false,error:'Resultado incierto'});fireEvent.click(screen.getByRole('button'));await screen.findByText('Resultado incierto');fireEvent.click(screen.getByRole('button'));await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(2));expect(mocks.save.mock.calls[0][0].request_key).toBe(mocks.save.mock.calls[1][0].request_key);fireEvent.change(screen.getByLabelText('Referencia única del mensaje o comprobante'),{target:{value:'synthetic-new'}});expect(screen.getByRole('checkbox')).not.toBeChecked()})
 it('muestra revisión si ya se invalidó, sin afirmar vigente',async()=>{open();fill();mocks.save.mockResolvedValue({ok:true,data:{invalidated_at:'2026-11-12T12:00:00Z'}});fireEvent.click(screen.getByRole('button'));expect(await screen.findByRole('status')).toHaveTextContent('requiere revisión por cambios')})
})
