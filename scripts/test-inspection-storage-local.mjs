// SOLO Supabase local real. No imprime tokens, URLs firmadas ni credenciales.
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import assert from 'node:assert/strict'
const log=process.env.AIRADMIN_LOCAL_STATUS_LOG
if(!log)throw Error('Indica AIRADMIN_LOCAL_STATUS_LOG de stack local')
const cfg=JSON.parse(readFileSync(log,'utf8').trim().split('\n').at(-1))
const base=new URL(cfg.API_URL)
if(!['127.0.0.1','localhost'].includes(base.hostname)||base.port!=='54321'||base.protocol!=='http:')throw Error('Solo API Supabase local 54321')
const options={auth:{persistSession:false,autoRefreshToken:false}}
const admin=createClient(base.href,cfg.SERVICE_ROLE_KEY,options),anon=createClient(base.href,cfg.ANON_KEY,options)
const run=randomUUID().slice(0,8),password=randomUUID()+randomUUID(),bucket='inspection-evidence'
async function ok(p){const r=await p;if(r.error)throw Error('Fixture/operación local falló: '+r.error.code);return r.data}
async function user(active){const email=`storage-${active}-${run}@example.test`;const {user}=await ok(admin.auth.admin.createUser({email,password,email_confirm:true}));await ok(admin.from('team_members').insert({id:user.id,name:`Storage ${active} ${run}`,email,role:'cleaning',active}));const client=createClient(base.href,cfg.ANON_KEY,options);await ok(client.auth.signInWithPassword({email,password}));return {id:user.id,client}}
const active=await user(true),inactive=await user(false)
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const checkout=new Date(Date.parse(today+'T12:00:00Z')+172800000).toISOString().slice(0,10)
const property=await ok(admin.from('properties').insert({name:`Storage Sintético ${run}`,capacity:2}).select('id').single())
const stay=await ok(admin.from('reservations').insert({property_id:property.id,source:'direct',guest_name:`Storage Sintético ${run}`,guests:1,check_in:today,check_out:checkout,status:'confirmed'}).select('id').single())
const path=`${active.id}/${stay.id}/${randomUUID()}.png`
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1cAAAAASUVORK5CYII=','base64')
await ok(active.client.storage.from(bucket).upload(path,png,{contentType:'image/png',upsert:false}))
const downloaded=await ok(active.client.storage.from(bucket).download(path));assert.equal(downloaded.size,png.length)
console.log('PASS carga/lectura PNG sintético por limpieza activa')
assert.ok((await anon.storage.from(bucket).download(path)).error)
assert.ok((await inactive.client.storage.from(bucket).download(path)).error)
assert.ok((await inactive.client.storage.from(bucket).createSignedUrl(path,30)).error)
const publicResponse=await fetch(`${base.origin}/storage/v1/object/public/${bucket}/${path}`);assert.ok(!publicResponse.ok)
assert.ok((await inactive.client.storage.from(bucket).upload(`${inactive.id}/${stay.id}/${randomUUID()}.png`,png,{contentType:'image/png'})).error)
assert.ok((await active.client.storage.from(bucket).upload(`${inactive.id}/${stay.id}/${randomUUID()}.png`,png,{contentType:'image/png'})).error)
console.log('PASS lectura pública/anon/inactiva y escritura ajena denegadas')
assert.ok((await active.client.storage.from(bucket).upload(`${active.id}/${stay.id}/${randomUUID()}.png`,Buffer.alloc(5*1024*1024+1),{contentType:'image/png'})).error)
assert.ok((await active.client.storage.from(bucket).upload(`${active.id}/${stay.id}/${randomUUID()}.svg`,Buffer.from('<svg/>'),{contentType:'image/svg+xml'})).error)
console.log('PASS bucket rechaza tamaño >5 MB y MIME SVG')
const recorded=await ok(active.client.rpc('record_arrival_inspection',{p_reservation_id:stay.id,p_property_id:property.id,p_stay_check_in:today,p_stay_check_out:checkout,p_item:'water',p_result:'issue',p_note:'Fuga de prueba sintética, no real',p_photo_path:path,p_expected_version:0,p_request_key:randomUUID()}));assert.equal(recorded.ok,true)
const state=await ok(active.client.from('arrival_inspections').select('checks,version').eq('reservation_id',stay.id).single());assert.equal(state.checks.water.photo_path,path);assert.equal(state.checks.water.actor_id,active.id)
console.log('PASS RPC/relectura vinculan evidencia privada, incidencia y actor real de Auth local')
const signed=await ok(active.client.storage.from(bucket).createSignedUrl(path,2))
assert.equal((await fetch(signed.signedUrl)).ok,true)
await new Promise(resolve=>setTimeout(resolve,4000))
const expired=await fetch(signed.signedUrl);assert.equal(expired.ok,false)
console.log('PASS URL firmada funciona y caduca (TTL 2s, prueba a +4s)')
await active.client.auth.signOut();await inactive.client.auth.signOut()
console.log('Pruebas Storage/Auth local real completadas. Fixtures sintéticos conservados en stack local; sin producción.')
