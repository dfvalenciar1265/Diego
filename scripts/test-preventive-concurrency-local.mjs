// API/Auth reales SOLO Supabase loopback local; fixtures sintéticos conservados.
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {createClient} from '@supabase/supabase-js'
if(!process.env.AIRADMIN_LOCAL_STATUS_LOG)throw Error('Falta archivo status LOCAL')
const cfg=JSON.parse(readFileSync(process.env.AIRADMIN_LOCAL_STATUS_LOG,'utf8').trim().split('\n').at(-1))
const url=new URL(cfg.API_URL)
if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.port!=='54321')throw Error('Solo loopback local54321')
const db=createClient(url.href,cfg.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
async function ok(p){const r=await p;if(r.error)throw Error(`Operación local falló (${r.error.code??'sin código'})`);return r.data}
const run=randomUUID(),email=`concurrency-${run}@example.test`
const {user}=await ok(db.auth.admin.createUser({email,password:randomUUID()+randomUUID(),email_confirm:true}))
await ok(db.from('team_members').insert({id:user.id,name:'Administrador sintético concurrencia',email,role:'admin',active:true}))
const property=await ok(db.from('properties').insert({name:`Concurrencia sintética ${run}`,capacity:2}).select('id').single())
const parent=await ok(db.from('maintenance').insert({property_id:property.id,title:'Preventivo sintético concurrente',priority:'scheduled',status:'open',notes:'Nota histórica sintética, no diagnóstico',reported_by:user.id,next_due:'2027-02-10',last_done:'2026-10-10',cost:123.45}).select('*').single())
const base={parent_id:parent.id,parent_snapshot:parent,disposition:'create_report',reason:'Revisión explícita sintética para comprobar exclusión concurrente',corrective_id:null,corrective_snapshot:null,expected_version:0,confirmed:true}
const results=await Promise.all(['A','B'].map(source=>ok(db.rpc('save_preventive_note_review',{p_source:'mcp',p_actor_id:user.id,p_input:{...base,source_reference:`fuente-${source}`,request_key:randomUUID()}}))))
assert.equal(results.filter(r=>r.ok===true).length,1)
assert.equal(results.filter(r=>r.ok===false&&r.conflict===true).length,1)
const children=await ok(db.from('maintenance').select('id').eq('property_id',property.id).neq('priority','scheduled'));assert.equal(children.length,1)
const reviews=await ok(db.from('preventive_note_reviews').select('id,corrective_id').eq('parent_id',parent.id));assert.equal(reviews.length,1);assert.equal(reviews[0].corrective_id,children[0].id)
const reread=await ok(db.from('maintenance').select('*').eq('id',parent.id).single());assert.deepEqual(reread,parent)
console.log('PASS API concurrente local: 1 éxito + 1 conflicto, 1 correctivo + 1 revisión, parent íntegro. Sin producción.')
