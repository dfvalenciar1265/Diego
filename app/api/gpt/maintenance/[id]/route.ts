/**
 * PATCH /api/gpt/maintenance/{id} — cambia estado, agrega una nota o registra el costo.
 * En preventivos recurrentes "resolved" equivale al botón "Hecho" de la app.
 */
import type { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { serviceDb } from '@/lib/gpt-api/db'
import { errorResponse, jsonResponse, readJson, withApiKey } from '@/lib/gpt-api/http'
import { updateMaintenance } from '@/lib/gpt-api/maintenance'
import { isUuid, parseMaintenancePatch } from '@/lib/gpt-api/validate'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiKey(req, async () => {
    const { id } = await ctx.params
    if (!isUuid(id)) return errorResponse(404, 'No existe ese pendiente.')
    const patch = parseMaintenancePatch(await readJson(req))
    if (!patch.ok) return errorResponse(400, patch.error)

    const result = await updateMaintenance(serviceDb(), id, patch.value, todayInBogota())
    if (!result) return errorResponse(404, 'No existe ese pendiente.')
    revalidatePath('/maintenance')
    revalidatePath('/')
    return jsonResponse(result)
  })
}
