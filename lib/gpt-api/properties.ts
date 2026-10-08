import { resolvePropertyId } from '@/lib/gmail-sync'
import type { Db } from './db'

export interface PropertyRef {
  id: string
  name: string
}

/** Minúsculas, sin tildes y con espacios simples, para comparar nombres. */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Apartamento de la app que nombra un texto ("Palmetto 1001", "palmetto 1001 · Frente al mar…").
 * Gana el nombre más largo contenido en el texto; si ninguno, los alias de la sincronización de
 * Gmail (room ID o título del anuncio, p. ej. "Loft Moderno … Ángel del Mar" → Cartagena Beach 1214).
 */
export function resolveProperty(text: string, properties: PropertyRef[]): PropertyRef | null {
  const haystack = normalizeText(text)
  if (!haystack) return null
  const byName = [...properties]
    .sort((a, b) => b.name.length - a.name.length)
    .find(p => haystack.includes(normalizeText(p.name)))
  if (byName) return byName
  const aliasId = resolvePropertyId(text)
  return properties.find(p => p.id === aliasId) ?? null
}

/** Apartamentos (id y nombre, nada más: nunca códigos de acceso ni direcciones). */
export async function listProperties(db: Db, opts: { onlyActive?: boolean } = {}): Promise<PropertyRef[]> {
  let query = db.from('properties').select('id, name').order('name')
  if (opts.onlyActive) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as PropertyRef[]
}
