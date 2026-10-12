import { describe, it, expect } from 'vitest'
import { navItemsFor, splitMobileNav } from '@/components/layout/nav-items'

const hrefs = (xs: { href: string }[]) => xs.map(x => x.href)

describe('splitMobileNav', () => {
  it('admin: Inicio, Reservas, Limpieza y Mantenimiento en la barra; el resto bajo «Más»', () => {
    const { primary, more } = splitMobileNav(navItemsFor('admin'))
    expect(hrefs(primary)).toEqual(['/', '/calendar', '/cleaning', '/maintenance'])
    expect(hrefs(more)).toEqual(['/tasks', '/properties', '/reports', '/team', '/settings/gmail'])
  })

  it.each(['cleaning', 'maintenance', 'anfitrion'] as const)('%s: con ≤5 destinos ve todo y no hay «Más»', role => {
    const items = navItemsFor(role)
    expect(items.length).toBeLessThanOrEqual(5)
    const { primary, more } = splitMobileNav(items)
    expect(primary).toEqual(items)
    expect(more).toEqual([])
  })

  it('sin los preferidos, completa con los primeros disponibles en su orden', () => {
    const items = navItemsFor('admin').filter(it => it.href !== '/calendar' && it.href !== '/cleaning')
    const { primary, more } = splitMobileNav(items)
    expect(hrefs(primary)).toEqual(['/', '/tasks', '/maintenance', '/properties'])
    expect(primary.length + more.length).toBe(items.length)
  })
})
