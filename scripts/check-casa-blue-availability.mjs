// Public read-only acceptance check. No tokens or guest count required.
const [arrival, departure, endpoint = 'https://diegoprueba.vercel.app/api/public/casa-blue/availability'] = process.argv.slice(2)
const slugs = ['mar-adentro-1305', 'torres-del-lago-1303', 'crespo-1214', 'conquistador-1821', 'marina-del-rey-1104', 'palmetto-1001', 'tocahagua-1208', 'tocahagua-708']
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value+'T12:00:00Z').toISOString().slice(0,10) === value
try {
  if (!date(arrival) || !date(departure) || departure <= arrival) throw new Error('Uso: node scripts/check-casa-blue-availability.mjs YYYY-MM-DD YYYY-MM-DD [endpoint]')
  const url = new URL(endpoint)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Se requiere HTTPS o un servidor local.')
  url.search = new URLSearchParams({arrival, departure}).toString()
  const res = await fetch(url, {headers: {Accept: 'application/json', Origin: 'https://casabluecartagena.com'}, cache: 'no-store', signal: AbortSignal.timeout(6000)})
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: la API debe admitir la consulta sin guests.`)
  if (res.headers.get('cache-control') !== 'no-store') throw new Error('Falta Cache-Control: no-store.')
  const data = await res.json()
  if (data.query?.arrival !== arrival || data.query?.departure !== departure || data.query?.guests !== undefined) throw new Error('La API no devuelve la consulta por fechas esperada.')
  if (data.sourceStatus !== 'ready') throw new Error(`La búsqueda real sigue pendiente: sourceStatus=${data.sourceStatus}.`)
  const now = Date.now(), sync = Date.parse(data.lastSyncedAt), queried = Date.parse(data.queriedAt)
  if (!Number.isFinite(sync) || now-sync > 900000 || sync-now > 60000 || !Number.isFinite(queried) || Math.abs(now-queried) > 120000) throw new Error('Sincronización o consulta fuera de los límites de frescura.')
  if (!date(data.coverage?.from) || !date(data.coverage?.to) || data.coverage.from > arrival || data.coverage.to < departure) throw new Error('La cobertura no comprende la estancia.')
  if (!Array.isArray(data.apartments) || data.apartments.length !== 8 || data.apartments.some((a,i) => a.slug !== slugs[i])) throw new Error('Faltan unidades o el orden del catálogo no coincide.')
  const unknown = data.apartments.filter(a => a.status === 'unknown')
  if (unknown.length) throw new Error(`Falta confirmar: ${unknown.map(a=>a.slug).join(', ')}.`)
  if (data.apartments.some(a=>!['available','occupied'].includes(a.status))) throw new Error('Estado de unidad no válido.')
  console.log(JSON.stringify({status:'ready',query:data.query,lastSyncedAt:data.lastSyncedAt,available:data.apartments.filter(a=>a.status==='available').length,occupied:data.apartments.filter(a=>a.status==='occupied').length,apartments:8}))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'No se pudo comprobar la disponibilidad.')
  process.exitCode = 1
}
