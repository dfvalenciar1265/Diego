import {cleanup,render,screen,waitFor} from '@testing-library/react'
import {afterEach,describe,it,expect,vi} from 'vitest'
import {CheckoutOptionalChecks} from '@/components/dashboard/CheckoutOptionalChecks'
const mocks=vi.hoisted(()=>({load:vi.fn(),omit:vi.fn()}))
vi.mock('@/actions/checkout-checks',()=>({loadCheckoutChecks:mocks.load,omitCheckoutCheck:mocks.omit}))
afterEach(()=>{cleanup();vi.resetAllMocks()})
const stay={id:'stay',property_id:'property',check_in:'2026-11-10',check_out:'2026-11-12'}
const source={id:'issue',property_id:'property',title:'Platos faltantes',priority:'normal',status:'open',fingerprint:'hash'}
const item={id:'prompt',instruction:'Contar platos disponibles',source,source_snapshot:source,property_id:'property',source_id:'issue',stale:false}
describe('salida opcional sin ruido',()=>{
 it('no muestra nada sin selección explícita',async()=>{mocks.load.mockResolvedValue({items:[]});const {container}=render(<CheckoutOptionalChecks stay={stay} canOmit/>);await waitFor(()=>expect(mocks.load).toHaveBeenCalled());expect(container).toBeEmptyDOMElement()})
 it('omisión limpia tarjeta pero no borra historial',async()=>{mocks.load.mockResolvedValue({items:[{...item,skipped:{id:'skip',reason:'No acceso',author:'Persona'}}]});const {container}=render(<CheckoutOptionalChecks stay={stay} canOmit/>);await waitFor(()=>expect(mocks.load).toHaveBeenCalled());expect(container).toBeEmptyDOMElement();expect(mocks.omit).not.toHaveBeenCalled()})
 it('no reutiliza avisos de otra estancia mientras carga',async()=>{mocks.load.mockResolvedValueOnce({items:[item]}).mockImplementationOnce(()=>new Promise(()=>{}));const {rerender}=render(<CheckoutOptionalChecks stay={stay} canOmit/>);await screen.findByText('Contar platos disponibles');rerender(<CheckoutOptionalChecks stay={{...stay,id:'other'}} canOmit/>);expect(screen.queryByText('Contar platos disponibles')).not.toBeInTheDocument()})
})
