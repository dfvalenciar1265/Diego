import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getCurrentMember } from '@/lib/auth'
import { gmailSyncDb, runGmailSync } from '@/lib/gmail-reconciliation/runner'

export const maxDuration = 300

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const cron = Boolean(secret && req.headers.get('authorization') === `Bearer ${secret}`)
  let actorId: string | undefined
  if (!cron) {
    if (req.method === 'GET') return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const member = await getCurrentMember()
    if (!member || member.role !== 'admin') return NextResponse.json({ error: 'Solo administradores activos' }, { status: 403 })
    actorId = member.id
  }
  const raw = req.nextUrl.searchParams.get('days')
  const days = raw === null ? 365 : Number(raw)
  if (!Number.isInteger(days) || days < 1 || days > 1825) return NextResponse.json({ error: 'days debe ser un entero de 1 a 1825' }, { status: 400 })
  const result = await runGmailSync({ via: cron ? 'cron' : 'manual', actorId, days }, { db: gmailSyncDb() })
  for (const path of ['/', '/calendar', '/cleaning', '/tasks', '/settings/gmail']) revalidatePath(path)
  return NextResponse.json(result, { status: result.state === 'complete' ? 200 : result.state === 'partial' ? 207 : result.state === 'busy' ? 409 : 503 })
}
export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
