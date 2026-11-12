import {cleanup,render,screen} from '@testing-library/react'
import {afterEach,expect,it} from 'vitest'
import {ArrivalIssues} from '@/components/dashboard/ArrivalIssues'
afterEach(cleanup)
it('muestra vínculo y reporte sin volver una nota en diagnóstico',()=>{render(<ArrivalIssues preparation={{error:null,requests:[],issues:[{id:'synthetic',property_id:'property-synthetic',title:'Reporte sintético',priority:'normal',status:'open',preventive_links:[{parent_id:'parent-synthetic',title:'Aire sintético',pending_verification:true}]}]}}/>);expect(screen.getByText(/Preventivo asociado: Aire sintético/)).toHaveTextContent('Reporte pendiente de comprobar');expect(screen.getByText(/No modifica su programación/)).toBeVisible()})
