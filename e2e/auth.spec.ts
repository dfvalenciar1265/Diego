import { test, expect } from '@playwright/test'

// Sin sesión: no inicia sesión ni escribe nada en Supabase.

const PROTECTED_ROUTES = [
  '/',
  '/calendar',
  '/cleaning',
  '/maintenance',
  '/properties',
  '/reports',
  '/tasks',
  '/team',
  '/settings/gmail',
]

test.describe('sin sesión', () => {
  for (const route of PROTECTED_ROUTES) {
    test(`${route} redirige a /login`, async ({ page }) => {
      await page.goto(route)
      await expect(page).toHaveURL(/\/login$/)
    })
  }
})

test.describe('pantalla de login', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
  })

  test('muestra el formulario', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'AirAdmin' })).toBeVisible()
    await expect(page.getByLabel('Tu nombre')).toBeVisible()
    await expect(page.getByLabel('Contraseña')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled()
  })

  test('no envía con campos vacíos', async ({ page }) => {
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByLabel('Tu nombre')).toBeFocused()
  })

  test('rechaza un nombre que no existe sin revelar si existe', async ({ page }) => {
    // Sin coincidencia por nombre el servidor responde antes de intentar la contraseña.
    // El mensaje es el mismo que con contraseña incorrecta (no deja sondear nombres).
    await page.getByLabel('Tu nombre').fill('Usuario Inexistente E2E Zzq')
    await page.getByLabel('Contraseña').fill('no-importa')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByText('Nombre o contraseña incorrectos')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })
})
