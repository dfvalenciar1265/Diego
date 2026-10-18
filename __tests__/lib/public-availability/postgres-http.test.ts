// @vitest-environment node
// Opt-in only: a disposable local DB (Docker, or local psql socket with CASA_BLUE_LOCAL_POSTGRES_RUNNER=psql),
// never a Supabase/production connection.
import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import http from 'node:http'
import { CASA_BLUE_CATALOG } from '@/lib/public-availability/catalog'
import { handleAvailability } from '@/lib/public-availability/handler'
import { RateLimiter } from '@/lib/public-availability/http'

const exec = promisify(execFile)
const enabled = process.env.CASA_BLUE_LOCAL_POSTGRES_TEST === '1'

describe.skipIf(!enabled)('API HTTP con PostgreSQL real local', () => {
  it('al cambiar fechas cambia occupied a available, sin huéspedes ni diferencias de capacidad', async () => {
    const container = 'airadmin-casa-blue-test-db'
    const database = `airadmin_migrations_test_http_${process.pid}`
    const env = { ...process.env }
    for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[key]
    const docker = (...args: string[]) => exec('docker', ['--host=unix:///var/run/docker.sock', ...args], {env, maxBuffer: 1_000_000})
    const local = process.env.CASA_BLUE_LOCAL_POSTGRES_RUNNER === 'psql'
    if (local) for (const key of ['PGHOST', 'PGHOSTADDR', 'PGSERVICE', 'DATABASE_URL']) delete env[key]
    const sql = async (statement: string) => (local
      ? await exec('psql', ['-XAt', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', statement], {env, maxBuffer: 1_000_000})
      : await docker('exec', '--env', 'PGUSER=postgres', container,
        'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', statement)).stdout.trim()
    let server: http.Server | undefined
    try {
      if (local) await exec('bash', ['scripts/test-migrations.sh'], {env: {...env, CASA_BLUE_LOCAL_TEST_DB: database, CASA_BLUE_KEEP_LOCAL_TEST_DB: '1'}, maxBuffer: 1_000_000})
      else await docker('exec', '--env', 'PGUSER=postgres', '--env', `CASA_BLUE_LOCAL_TEST_DB=${database}`,
        '--env', 'CASA_BLUE_KEEP_LOCAL_TEST_DB=1', container, 'bash', '-lc', 'cd /repo && bash scripts/test-migrations.sh')
      for (const c of CASA_BLUE_CATALOG) {
        await sql(`INSERT INTO public.properties(id,name,capacity) VALUES('${c.propertyId}','Sintetico HTTP',${c.slug === 'crespo-1214' ? 2 : c.capacity}) ON CONFLICT(id) DO NOTHING;
          INSERT INTO public.availability_rules(property_id,min_nights,advance_notice_hours,preparation_nights,same_day_turnover,verified_at)
          VALUES('${c.propertyId}',2,0,0,true,now()) ON CONFLICT(property_id) DO NOTHING;`)
      }
      const palmetto = CASA_BLUE_CATALOG.find(c => c.slug === 'palmetto-1001')!.propertyId
      await sql(`SELECT public.record_calendar_sync('airbnb-ical',clock_timestamp(),clock_timestamp(),'2026-10-18','2027-10-18',
        ARRAY[${CASA_BLUE_CATALOG.map(c => `'${c.propertyId}'`).join(',')}]::uuid[],
        '[{"property_id":"${palmetto}","uid":"http-sintetico","start":"2026-11-12","end":"2026-11-15","kind":"reserved"}]'::jsonb);`)
      const db = { rpc(fn: string, args: Record<string, unknown>) {
        if (fn !== 'read_casa_blue_availability') throw new Error('Only the read function is allowed')
        for (const value of Object.values(args)) if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid test date')
        return sql(`SELECT public.read_casa_blue_availability('${args.p_arrival}'::date,'${args.p_departure}'::date);`)
          .then(text => ({data: JSON.parse(text), error: null}))
      } }
      const limiter = new RateLimiter()
      server = http.createServer(async (req, res) => {
        const out = await handleAvailability(new Request('http://localhost'+req.url, {headers: {origin: 'http://localhost:4321'}}), {
          db: () => db, now: () => new Date(), limiter,
          env: {NODE_ENV: 'development', CASA_BLUE_CORS_DEV_ORIGINS: 'http://localhost:4321'},
        })
        res.writeHead(out.status, Object.fromEntries(out.headers));res.end(await out.text())
      })
      await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as {port: number}).port
      const get = async (arrival: string, departure: string) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/public/casa-blue/availability?arrival=${arrival}&departure=${departure}`)
        expect(res.status).toBe(200)
        expect(res.headers.get('cache-control')).toBe('no-store')
        expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:4321')
        return res.json()
      }
      const occupied = await get('2026-11-10', '2026-11-13')
      expect(occupied.sourceStatus).toBe('ready')
      expect(occupied.query).toEqual({arrival: '2026-11-10', departure: '2026-11-13'})
      expect(occupied.apartments.filter((a: {status: string}) => a.status === 'available')).toHaveLength(7)
      expect(occupied.apartments.find((a: {slug: string}) => a.slug === 'palmetto-1001').status).toBe('occupied')
      expect(occupied.apartments.find((a: {slug: string}) => a.slug === 'crespo-1214').status).toBe('available')
      const free = await get('2026-11-20', '2026-11-23')
      expect(free.sourceStatus).toBe('ready')
      expect(free.apartments.every((a: {status: string}) => a.status === 'available')).toBe(true)
      const acceptance = await exec(process.execPath, ['scripts/check-casa-blue-availability.mjs', '2026-11-10', '2026-11-13', `http://127.0.0.1:${port}/api/public/casa-blue/availability`])
      expect(JSON.parse(acceptance.stdout)).toMatchObject({status:'ready',available:7,occupied:1,apartments:8})
    } finally {
      if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
      if (local) await exec('dropdb', ['--if-exists', database], {env})
      else await docker('exec', '--env', 'PGUSER=postgres', container, 'dropdb', '--if-exists', database)
    }
  }, 30_000)
})
