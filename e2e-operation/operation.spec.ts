import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
const url=process.env.NEXT_PUBLIC_SUPABASE_URL!
const parsed=new URL(url)
if(!['localhost','127.0.0.1'].includes(parsed.hostname)||parsed.port!=='54321')throw Error('Solo Supabase local')
const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
const run=randomUUID().slice(0,8),password=`Local-test-${randomUUID()}`
const users:Record<string,{id:string;name:string;email:string}>={}
let reservation:string,property:string
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const localHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Bogota',hour:'2-digit',hourCycle:'h23'}).format(new Date()))
const arrivalDate=localHour>=19?new Date(Date.parse(`${today}T12:00:00Z`)+86400000).toISOString().slice(0,10):today
const checkout=new Date(Date.parse(`${today}T12:00:00Z`)+86400000*2).toISOString().slice(0,10)
async function checked<T extends {error:unknown}>(p:PromiseLike<T>):Promise<T>{const r=await p;if(r.error)throw Error('Operación de fixture local falló');return r}
async function login(page:Page,role:string){await page.goto('/login');await page.getByLabel('Tu nombre').fill(users[role].name);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page).toHaveURL(/\/$/)}
test.beforeAll(async()=>{
 for(const role of ['admin','cleaning','unauthorized']){
  const name=`E2E ${role} ${run}`,email=`${role}-${run}@example.test`
  const result=await checked(db.auth.admin.createUser({email,password,email_confirm:true}));const id=result.data.user!.id;users[role]={id,name,email}
  // Unauthorized has a valid Auth user but no team membership; no signInWithName bypass.
  if(role!=='unauthorized')await checked(db.from('team_members').insert({id,name,email,role,active:true}))
 }
 const p=await checked(db.from('properties').insert({name:`E2E Apartamento ${run}`,capacity:4}).select('id').single());property=p.data!.id
 const r=await checked(db.from('reservations').insert({property_id:property,source:'direct',guest_name:`E2E Huésped ${run}`,guests:2,check_in:arrivalDate,check_out:checkout,status:'confirmed'}).select('id').single());reservation=r.data!.id
})
test('admin guarda borrador y persiste, sin envíos',async({page})=>{
 await login(page,'admin');await page.goto('/direct-messages');const section=page.locator('section').filter({hasText:`E2E Huésped ${run}`});await section.getByText('Llegada · Sin planificar',{exact:true}).click();const editor=section.locator('details').filter({hasText:'Llegada · Sin planificar'});await editor.getByLabel('Texto por revisar').fill('Texto sintético pendiente de aprobación');await editor.getByRole('checkbox').check();await editor.getByRole('button',{name:'Guardar borrador',exact:true}).click();await expect(section.getByText('Llegada · Borrador guardado',{exact:true})).toBeVisible();await page.reload();await expect(section.getByText('Llegada · Borrador guardado',{exact:true})).toBeVisible()
 const row=await checked(db.from('direct_message_drafts').select('status,channel,recipient,body').eq('reservation_id',reservation).eq('stage','arrival').single());expect(row.data).toMatchObject({status:'draft',channel:'pending',recipient:'',body:'Texto sintético pendiente de aprobación'})
})
test('admin crea aviso interno sin publicar externamente',async({page})=>{
 await login(page,'admin');await page.goto('/temporary-notices');await page.getByRole('combobox',{name:'Apartamento',exact:true}).selectOption(property);await page.getByLabel('Título',{exact:true}).fill(`Aviso E2E ${run}`);await page.getByLabel('Texto vigente').fill('Aviso sintético; no comunica a terceros');await page.getByLabel('Último día de vigencia').fill(checkout);await page.getByLabel('Dónde se publicó, una ubicación por línea').fill('Prueba local sin publicación');await page.getByRole('button',{name:'Guardar registro interno'}).click();await expect(page.getByRole('heading',{name:`E2E Apartamento ${run} · Aviso E2E ${run}`,exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:`E2E Apartamento ${run} · Aviso E2E ${run}`,exact:true})).toBeVisible()
})
test('limpieza revisa checklist pero no accede a borradores',async({page})=>{
 await login(page,'cleaning');await page.goto('/direct-messages');await expect(page).toHaveURL(/\/$/);await page.goto(`/inspections?reservation=${reservation}`);await expect(page.getByRole('heading',{name:'Checklist para recibir'})).toBeVisible();await page.getByRole('button',{name:'Revisar este punto',exact:true}).first().click();await page.getByLabel('Foto privada opcional (máximo 5 MB)').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1cAAAAASUVORK5CYII=','base64')});await page.getByRole('button',{name:'Registrar lo revisado',exact:true}).click();await expect(page.getByText('✓ Revisado',{exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('button',{name:'Ver foto privada'})).toBeVisible();await page.screenshot({path:'/tmp/airadmin-checklist-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/airadmin-checklist-mobile.png',fullPage:true})
})
test('sin sesión no accede y Auth sin miembro no supera RLS',async({page})=>{
 await page.goto('/direct-messages');await expect(page).toHaveURL(/login/)
 const un=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});await checked(un.auth.signInWithPassword({email:users.unauthorized.email,password}));const result=await checked(un.from('direct_message_drafts').select('id'));expect(result.data).toEqual([]);const denied=await un.rpc('save_direct_message_draft',{p_input:{},p_source:'app',p_actor_id:users.unauthorized.id});expect(denied.error).not.toBeNull();await un.auth.signOut()
})
// No cleanup destructivo: fixtures aislados quedan en stack local para revisar resultados.
// El operador puede descartar exclusivamente ese stack tras verificar su identidad.

test('entrega histórica auditada sin inventar envío ni promover candidato',async({page})=>{
 const dburl=new URL(process.env.AIRADMIN_LOCAL_DB_URL!);if(dburl.hostname!=='127.0.0.1'||dburl.port!=='54322')throw Error('DB solo local')
 const recipient=randomUUID()
 execFileSync('/Applications/Postgres.app/Contents/Versions/18/bin/psql',['-X','-q','-v','ON_ERROR_STOP=1','-d',dburl.href,'-c',`INSERT INTO public.building_recipients(id,property_id,channel,address) VALUES('${recipient}','${property}','email','porter-${run}@example.test'); NOTIFY pgrst, 'reload schema';`],{stdio:'pipe'})
 await login(page,'admin');const card=page.locator('[data-home-edit-error]').filter({hasText:`E2E Huésped ${run}`});await card.getByRole('button',{name:/Aviso al edificio/}).click();await card.getByText('Registrar resultado o revisar destinatarios',{exact:true}).click();await card.getByRole('combobox',{name:'Destinatario del edificio'}).selectOption(recipient)
 await expect(card.getByText('Registrar un aviso enviado anteriormente',{exact:true})).toHaveCount(0)
 const candidate=await checked(db.from('building_recipients').select('verified_at').eq('id',recipient).single());expect(candidate.data!.verified_at).toBeNull()
 await card.getByLabel('Cómo verificaste el destinatario').fill('Verificación expresa sintética del destinatario local');await card.getByRole('button',{name:'Confirmar destinatario',exact:true}).click();await card.getByText('Registrar un aviso enviado anteriormente',{exact:true}).click()
 const yesterday=new Date(Date.now()-86400000-5*3600000).toISOString().slice(0,16)
 await card.getByRole('combobox',{name:'Hecho histórico comprobado'}).selectOption('delivered');await card.getByLabel('Cuándo ocurrió · Colombia').fill(yesterday);await card.getByLabel('Referencia única del mensaje o comprobante').fill(`receipt-${run}`);await card.getByLabel('Evidencia histórica (10–500 caracteres)').fill('Recibo sintético de entrega de ayer; no se envía nada');await card.getByRole('checkbox',{name:'Comprobé el hecho, destinatario, fechas y contenido de esta estancia.'}).check();await card.getByRole('button',{name:'Guardar hecho histórico'}).click()
 await expect(card.getByText('Entrega acreditada · evidencia histórica vigente',{exact:true})).toBeVisible();await expect(card.getByRole('button',{name:'Preparar borrador',exact:true})).toHaveCount(0);await expect(card.locator('a[href^="mailto:"],a[href*="wa.me"]')).toHaveCount(0)
 const stored=await checked(db.from('building_notice_observations').select('*').eq('reservation_id',reservation).eq('recipient_id',recipient).single());expect(stored.data!.status).toBe('delivered');expect(stored.data!.actor_id).toBe(users.admin.id);expect(Date.parse(stored.data!.occurred_at)).toBe(Date.parse(`${yesterday}:00-05:00`));expect(Date.parse(stored.data!.recorded_at)).toBeGreaterThan(Date.parse(stored.data!.occurred_at));expect((await checked(db.from('building_notices').select('id').eq('reservation_id',reservation))).data).toEqual([])
 await page.reload();await card.getByRole('button',{name:/Aviso al edificio/}).click();await card.getByText('Registrar resultado o revisar destinatarios',{exact:true}).click();await card.getByRole('combobox',{name:'Destinatario del edificio'}).selectOption(recipient);await expect(card.getByText('Entrega acreditada · evidencia histórica vigente',{exact:true})).toBeVisible();await page.screenshot({path:'/tmp/airadmin-historical-desktop.png',fullPage:true})
})

test('revisión explícita preventiva crea reporte por comprobar sin cambiar el preventivo',async({page})=>{
 const parent=await checked(db.from('maintenance').insert({property_id:property,title:`Preventivo E2E ${run}`,description:'Programación preventiva sintética',notes:'Nota antigua sintética: comprobar el aire; no es diagnóstico',priority:'scheduled',status:'open',reported_by:users.admin.id,next_due:'2027-02-10',last_done:'2026-10-10',cost:12345.67}).select('*').single())
 const original=parent.data!
 await login(page,'admin');await page.goto('/maintenance/review')
 const card=page.locator('article').filter({has:page.getByRole('heading',{name:`Preventivo E2E ${run}`,exact:true})})
 await card.getByText('Leer notas y descripción originales · solo contexto',{exact:true}).click()
 await expect(card.getByText('Nota antigua sintética: comprobar el aire; no es diagnóstico',{exact:true})).toBeVisible()
 await card.getByLabel('Referencia del fragmento revisado').fill(`Nota prueba ${run}`)
 await card.getByLabel('Decisión de esta revisión').selectOption('create_report')
 await card.getByLabel('Motivo y comprobación de la decisión').fill('Revisión sintética manual: debe comprobarse el funcionamiento antes de concluir')
 await expect(card.getByRole('button',{name:'Guardar revisión manual'})).toBeDisabled()
 await card.getByRole('checkbox').check();await card.getByRole('button',{name:'Guardar revisión manual'}).click()
 await expect(card.getByRole('status')).toContainText('Revisión registrada y verificada')
 await page.reload();await card.getByText('Revisiones registradas (1)',{exact:true}).click()
 await expect(card.getByText(/Reporte pendiente de comprobar/)).toBeVisible()
 const reread=await checked(db.from('maintenance').select('*').eq('id',original.id).single());expect(reread.data).toEqual(original)
 const review=await checked(db.from('preventive_note_reviews').select('corrective_id,report_state').eq('parent_id',original.id).single());expect(review.data!.report_state).toBe('pending_verification')
 const report=await checked(db.from('maintenance').select('priority,status,property_id').eq('id',review.data!.corrective_id).single());expect(report.data).toMatchObject({priority:'normal',status:'open',property_id:property})
 await page.goto('/');const preparation=page.locator('[data-home-edit-error]').filter({hasText:`E2E Huésped ${run}`});await expect(preparation.locator('li').filter({hasText:`Pendiente de comprobar: Preventivo E2E ${run}`})).toBeVisible();await expect(preparation.getByText(`Preventivo asociado: Preventivo E2E ${run} · Reporte pendiente de comprobar. No modifica su programación.`,{exact:true})).toBeVisible()
})
test('limpieza ve vínculo seguro pero no revisión privada de preventivo',async({page})=>{
 await login(page,'cleaning');await page.goto('/maintenance/review');await expect(page).toHaveURL(/\/maintenance$/)
 const client=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
 await checked(client.auth.signInWithPassword({email:users.cleaning.email,password}))
 const audit=await checked(client.from('preventive_note_reviews').select('*'));expect(audit.data).toEqual([])
 const parent=await checked(db.from('maintenance').insert({property_id:property,title:`Permisos E2E ${run}`,notes:'Nota privada sintética',priority:'scheduled',status:'open',reported_by:users.admin.id}).select('*').single())
 const saved=await checked(db.rpc('save_preventive_note_review',{p_source:'mcp',p_actor_id:users.admin.id,p_input:{parent_id:parent.data!.id,parent_snapshot:parent.data,source_reference:`permiso-${run}`,disposition:'create_report',reason:'Fixture sintético de permisos, por comprobar',corrective_id:null,corrective_snapshot:null,expected_version:0,request_key:randomUUID(),confirmed:true}}));expect(saved.data.ok).toBe(true)
 const review=await checked(db.from('preventive_note_reviews').select('corrective_id').eq('parent_id',parent.data!.id).single())
 const safe=await checked(client.rpc('list_preventive_links',{p_corrective_ids:[review.data!.corrective_id]}))
 expect(JSON.stringify(safe.data)).toContain('pending_verification');expect(JSON.stringify(safe.data)).not.toMatch(/parent_snapshot|corrective_snapshot|12345|Nota antigua/)
 await client.auth.signOut()
})
