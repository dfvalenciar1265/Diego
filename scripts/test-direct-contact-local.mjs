// Solo Supabase LOCAL sintético; no envíos ni credenciales remotas.
import {execFile,execFileSync} from 'node:child_process'
import {promisify} from 'node:util'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
const uri=new URL(process.env.AIRADMIN_LOCAL_DB_URL??'http://invalid')
assert(['postgres:','postgresql:'].includes(uri.protocol)&&uri.hostname==='127.0.0.1'&&uri.port==='54322'&&uri.pathname==='/postgres','Solo DB local54322')
const bin=process.env.LOCAL_PSQL_BIN??'/Applications/Postgres.app/Contents/Versions/18/bin/psql'
const args=['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-d',uri.href]
const sql=(text)=>execFileSync(bin,args,{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
const admin=randomUUID(),clean=randomUUID(),property=randomUUID(),reservation=randomUUID()
sql(`INSERT INTO auth.users(id)VALUES('${admin}'),('${clean}');INSERT INTO public.team_members(id,name,email,role,active)VALUES('${admin}','Contacto E2E Admin','${admin}@example.test','admin',true),('${clean}','Contacto E2E Limpieza','${clean}@example.test','cleaning',true);INSERT INTO public.properties(id,name)VALUES('${property}','Contacto E2E sintético');INSERT INTO public.reservations(id,property_id,source,guest_name,check_in,check_out)VALUES('${reservation}','${property}','direct','Contacto Sintético',current_date+5,current_date+7);`)
const before=sql(`SELECT md5(r::text)FROM public.reservations r WHERE id='${reservation}'`)
const query=(phone,key,version=0)=>`SELECT public.save_direct_reservation_contact('${reservation}','${phone}',${version},'${key}');`
const session=(who,body)=>`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='${who}';${body}COMMIT;`
const call=async(key)=>{const {stdout}=await promisify(execFile)(bin,[...args,'-c',session(admin,query('+15555550123',key)+'SELECT pg_sleep(0.1);')]);return JSON.parse(stdout.split('\n').find(l=>l.startsWith('{')))}
const results=await Promise.all([call('parallel-a'),call('parallel-b')])
assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>r.conflict).length,1)
assert.equal(sql(`SELECT version FROM public.direct_reservation_contacts WHERE reservation_id='${reservation}'`),'1')
const winner=results[0].ok?'parallel-a':'parallel-b'
assert.equal(JSON.parse(sql(session(admin,query('+15555550123',winner)))).replayed,true)
assert.equal(JSON.parse(sql(session(admin,query('+15555550124',winner)))).conflict,true)
assert.equal(sql(session(clean,`SELECT count(*) FROM public.direct_reservation_contacts WHERE reservation_id='${reservation}';`)),'0')
assert.throws(()=>sql(session(clean,query('+15555550123','cleaning'))))
assert.throws(()=>sql(`BEGIN;SET LOCAL ROLE anon;SELECT * FROM public.direct_reservation_contacts;ROLLBACK;`))
assert.throws(()=>sql(session(admin,`UPDATE public.direct_reservation_contacts SET phone='';`)))
assert.equal(JSON.parse(sql(session(admin,query('', 'clear',1)))).ok,true)
assert.equal(sql(`SELECT version||':'||phone FROM public.direct_reservation_contacts WHERE reservation_id='${reservation}'`),'2:')
assert.equal(sql(`SELECT md5(r::text)FROM public.reservations r WHERE id='${reservation}'`),before)
sql(`UPDATE public.reservations SET source='airbnb' WHERE id='${reservation}';`)
assert.equal(JSON.parse(sql(session(admin,query('+15555550123','airbnb',2)))).ok,false)
console.log('PASS contacto privado: concurrencia1/2, idempotencia/conflicto, RLS, DML denegado, borrado lógico auditado, reserva intacta, Airbnb rechazado. Fixtures solo locales conservados.')
