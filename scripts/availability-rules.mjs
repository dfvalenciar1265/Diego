#!/usr/bin/env node
/**
 * Reglas de reserva por apartamento para la disponibilidad pública de Casa Blue.
 *
 *   node scripts/availability-rules.mjs plantilla > reglas.json   # todo en PENDIENTE
 *   node scripts/availability-rules.mjs revisar reglas.json        # valida, no escribe
 *   node scripts/availability-rules.mjs ver                        # reglas guardadas y conflictos
 *   node scripts/availability-rules.mjs aplicar reglas.json --verificado-por correo@dominio --si
 *
 * "aplicar" sin --si solo muestra lo que haría. Guarda únicamente apartamentos sin errores y los
 * marca verificados con la fecha de hoy y el administrador indicado. No toca reservas, capacidades
 * ni nada fuera de availability_rules. Lee NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
 * del entorno o de .env.local.
 */
import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Node carga los .ts directamente; su aviso de "module type" no aporta nada aquí.
process.removeAllListeners('warning')
const { CASA_BLUE_CATALOG } = await import('../lib/public-availability/catalog.ts')
const { rulesTemplate, validateRulesFile } = await import('../lib/public-availability/rules-input.ts')

const [cmd, file, ...rest] = process.argv.slice(2)
const flag = name => rest.includes(name) || file === name
const arg = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined }

function db() {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

function review(path) {
  const { fileErrors, results } = validateRulesFile(JSON.parse(readFileSync(path, 'utf8')), CASA_BLUE_CATALOG)
  for (const e of fileErrors) console.log(`✗ archivo: ${e}`)
  for (const u of CASA_BLUE_CATALOG) {
    const r = results.find(x => x.slug === u.slug)
    if (!r) console.log(`✗ ${u.slug}: falta en el archivo`)
    else if (r.ok) console.log(`✓ ${u.slug}: lista (${r.row.min_nights}+ noches, preparación ${r.row.preparation_nights}, mismo día ${r.row.same_day_turnover ? 'sí' : 'no'})`)
    else console.log(`✗ ${u.slug}:\n    - ${r.errors.join('\n    - ')}`)
  }
  return { fileErrors, results }
}

async function main() {
  if (cmd === 'plantilla') {
    console.log(JSON.stringify(rulesTemplate(CASA_BLUE_CATALOG), null, 2))
  } else if (cmd === 'revisar' && file) {
    const { fileErrors, results } = review(file)
    process.exitCode = fileErrors.length || results.some(r => !r.ok) || results.length < CASA_BLUE_CATALOG.length ? 1 : 0
  } else if (cmd === 'ver') {
    const client = db()
    const ids = CASA_BLUE_CATALOG.map(u => u.propertyId)
    const [{ data: rules, error: e1 }, { data: props, error: e2 }] = await Promise.all([
      client.from('availability_rules').select('property_id, min_nights, preparation_nights, same_day_turnover, verified_at, source_note').in('property_id', ids),
      client.from('properties').select('id, name, capacity, active').in('id', ids),
    ])
    if (e1) console.log(`availability_rules: ${e1.code} ${e1.message}`)
    if (e2) throw new Error(e2.message)
    for (const u of CASA_BLUE_CATALOG) {
      const p = props.find(x => x.id === u.propertyId)
      const r = rules?.find(x => x.property_id === u.propertyId)
      const cap = !p ? 'NO EXISTE en AirAdmin' : p.capacity === u.capacity ? `capacidad ${u.capacity} ✓` : `⚠️ capacidad sitio ${u.capacity} / AirAdmin ${p.capacity}`
      const rule = !r ? 'sin reglas' : r.verified_at ? `reglas verificadas ${r.verified_at.slice(0, 10)} (${r.source_note})` : 'reglas en borrador'
      console.log(`${u.slug.padEnd(22)} ${cap.padEnd(36)} ${rule}`)
    }
  } else if (cmd === 'aplicar' && file) {
    const by = arg('--verificado-por')
    if (!by) throw new Error('Falta --verificado-por <correo de un administrador>')
    const { fileErrors, results } = review(file)
    if (fileErrors.length) throw new Error('Corrige los errores del archivo antes de aplicar.')
    const rows = results.filter(r => r.ok).map(r => r.row)
    if (rows.length === 0) throw new Error('No hay apartamentos listos para guardar.')
    const client = db()
    const { data: admin, error } = await client.from('team_members').select('id, role, active').eq('email', by).maybeSingle()
    if (error) throw new Error(error.message)
    if (!admin || admin.role !== 'admin' || admin.active === false) throw new Error(`${by} no es un administrador activo`)
    const now = new Date().toISOString()
    const payload = rows.map(r => ({ ...r, verified_at: now, verified_by: admin.id, updated_at: now }))
    if (!flag('--si')) {
      console.log(`\nSimulación: guardaría ${payload.length} apartamento(s) como verificados por ${by}. Repite con --si para guardar.`)
      return
    }
    const { error: upsertError } = await client.from('availability_rules').upsert(payload, { onConflict: 'property_id' })
    if (upsertError) throw new Error(upsertError.message)
    console.log(`\nGuardados ${payload.length} apartamento(s) como verificados.`)
  } else {
    console.log('Uso: plantilla | revisar <archivo> | ver | aplicar <archivo> --verificado-por <correo> [--si]')
    process.exitCode = 2
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`)
  process.exitCode = 1
})
