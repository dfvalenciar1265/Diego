import {test,expect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
const url=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
if(url.hostname!=='127.0.0.1'||url.port!=='54321')throw Error('Solo local')
const db=createClient(url.href,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}})
const run=randomUUID().slice(0,8),password=randomUUID()+randomUUID()
async function ok<T extends {error:unknown}>(p:PromiseLike<T>){const r=await p;if(r.error)throw Error('Fixture local falló');return r}
test('selección manual y omisión opcional trazable sin resolver reporte',async({page})=>{
 const email=`checkout-${run}@example.test`,name=`Checkout Admin ${run}`
 const user=await ok(db.auth.admin.createUser({email,password,email_confirm:true}));const actor=user.data.user!.id
 await ok(db.from('team_members').insert({id:actor,email,name,role:'admin',active:true}))
 const property=(await ok(db.from('properties').insert({name:`Salida ${run}`,capacity:2}).select('id').single())).data!
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),before=new Date(Date.parse(today+'T12:00:00Z')-172800000).toISOString().slice(0,10)
 const stay=(await ok(db.from('reservations').insert({property_id:property.id,source:'direct',guest_name:`Sale ${run}`,check_in:before,check_out:today,status:'confirmed'}).select('id').single())).data!
 const issue=(await ok(db.from('maintenance').insert({property_id:property.id,title:`Platos reportados ${run}`,description:'Cantidad desconocida, contar disponibles',priority:'normal',status:'open',reported_by:actor}).select('*').single())).data!
 await page.goto('/login');await page.getByLabel('Tu nombre').fill(name);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page).toHaveURL(/\/$/)
 await page.goto('/maintenance/checkout-checks');await page.getByLabel('Reporte que necesita comprobación').selectOption(issue.id);await page.getByLabel('Qué comprobar al salir').fill(`Contar platos disponibles ${run}`);await page.getByRole('button',{name:'Activar aviso opcional'}).click();await expect(page.getByRole('status')).toContainText('guardado y verificado')
 await page.goto('/');const card=page.locator('section').filter({has:page.getByRole('heading',{name:'Comprobaciones opcionales',exact:true})}).filter({hasText:`Contar platos disponibles ${run}`}).last()
 await expect(card.getByText(`Contar platos disponibles ${run}`,{exact:true})).toBeVisible();await card.getByLabel('Motivo para omitir').fill('No hubo acceso al armario');await card.getByRole('button',{name:'Omitir solo esta salida'}).click();await expect(page.getByText(`Contar platos disponibles ${run}`,{exact:true})).toHaveCount(0);await page.reload();await expect(page.getByText(`Contar platos disponibles ${run}`,{exact:true})).toHaveCount(0)
 const reread=(await ok(db.from('maintenance').select('*').eq('id',issue.id).single())).data;expect(reread).toEqual(issue)
 // Audit read uses authorized authenticated session, not service-role table access.
 const client=createClient(url.href,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}});await ok(client.auth.signInWithPassword({email,password}));const skips=await ok(client.from('checkout_check_skips').select('actor_id,reason').eq('reservation_id',stay.id));expect(skips.data).toEqual([{actor_id:actor,reason:'No hubo acceso al armario'}]);await client.auth.signOut()
 await page.screenshot({path:'/tmp/airadmin-checkout-optional-desktop.png',fullPage:true})
})
