'use server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { escapeLike } from '@/lib/like'

/** Same message for "no such name" and "wrong password", so the form can't be used to probe names. */
const BAD_LOGIN = 'Nombre o contraseña incorrectos.'

/**
 * Sign-in by first name. The name → email lookup and the password check both
 * happen here, on the server: the email never reaches the browser (the old
 * lookupEmailByName handed any member's email to anyone, wildcards included).
 * The session cookies are set by the server client on this response.
 */
export async function signInWithName(
  name: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cleanName = typeof name === 'string' ? name.trim() : ''
  if (!cleanName || cleanName.length > 80 || typeof password !== 'string' || !password) {
    return { ok: false, error: BAD_LOGIN }
  }

  // Service client: the lookup runs before there is a session (RLS would hide the row)
  const db = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data: matches, error } = await db
    .from('team_members')
    .select('email')
    .ilike('name', escapeLike(cleanName))   // exact, case-insensitive
    .eq('active', true)
    .limit(2)
  if (error) {
    console.error('[signInWithName] lookup', error.message)
    return { ok: false, error: 'No se pudo iniciar sesión. Reintenta en un momento.' }
  }
  // Two active people with the same name would be ambiguous: refuse rather than guess
  if (!matches || matches.length !== 1) return { ok: false, error: BAD_LOGIN }

  const supabase = await createClient()
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: matches[0].email,
    password,
  })
  if (authError) return { ok: false, error: BAD_LOGIN }
  return { ok: true }
}
