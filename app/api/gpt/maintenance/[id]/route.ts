/**
 * PATCH /api/gpt/maintenance/{id} — cambia estado, agrega una nota o registra el costo.
 * En preventivos recurrentes "resolved" equivale al botón "Hecho" de la app.
 */
import type { NextRequest } from 'next/server'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { serviceDb } from '@/lib/gpt-api/db'
import { readJson, toResponse, withApiKey } from '@/lib/gpt-api/http'
import { updateMaintenanceTool } from '@/lib/gpt-api/service'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiKey(req, async () => {
    const { id } = await ctx.params
    return toResponse(await updateMaintenanceTool(serviceDb(), id, await readJson(req), todayInBogota()))
  })
}
