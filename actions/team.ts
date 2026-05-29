'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { canDo } from '@/lib/permissions'
import type { TeamMember, UserRole } from '@/lib/types'

async function getCallerRole(): Promise<UserRole | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('team_members').select('role').eq('id', user.id).single()
  return (data?.role as UserRole) ?? null
}

export async function getTeamMembers(role?: UserRole): Promise<TeamMember[]> {
  const supabase = await createClient()
  let query = supabase
    .from('team_members')
    .select('*')
    .eq('active', true)
    .order('name')
  if (role) query = query.eq('role', role)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Creates a new Supabase Auth user + team_members record.
 * Uses the service-role client so it can call auth.admin.createUser.
 */
export async function createTeamMember(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const callerRole = await getCallerRole()
  if (!callerRole || !canDo(callerRole, 'team:manage')) {
    return { success: false, error: 'No autorizado' }
  }

  const name     = (formData.get('name') as string).trim()
  const email    = (formData.get('email') as string).trim().toLowerCase()
  const memberRole = (formData.get('role') as string) || 'cleaning'
  const password = (formData.get('password') as string) || generateTempPassword()

  const db = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Create auth account
  const { data: authData, error: authErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,   // skip email verification
  })
  if (authErr) return { success: false, error: authErr.message }

  // Create team_members record with the same UUID
  const { error: dbErr } = await db.from('team_members').insert({
    id:     authData.user.id,
    name,
    email,
    role:   memberRole,
    active: true,
  })
  if (dbErr) {
    // Roll back auth user if DB insert fails
    await db.auth.admin.deleteUser(authData.user.id)
    return { success: false, error: dbErr.message }
  }

  revalidatePath('/cleaning')
  revalidatePath('/tasks')
  return { success: true }
}

/** Updates name, email, role, and optionally resets password. */
export async function updateTeamMember(
  memberId: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const callerRole = await getCallerRole()
  if (!callerRole || !canDo(callerRole, 'team:manage')) {
    return { success: false, error: 'No autorizado' }
  }

  const name     = (formData.get('name') as string).trim()
  const email    = (formData.get('email') as string).trim().toLowerCase()
  const role     = (formData.get('role') as UserRole) || 'cleaning'
  const password = (formData.get('password') as string).trim()

  const db = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Update auth account (email + optional password)
  const authUpdate: Record<string, string> = { email }
  if (password) authUpdate.password = password
  const { error: authErr } = await db.auth.admin.updateUserById(memberId, authUpdate)
  if (authErr) return { success: false, error: authErr.message }

  // Update team_members record
  const { error } = await db
    .from('team_members')
    .update({ name, email, role })
    .eq('id', memberId)
  if (error) return { success: false, error: error.message }

  revalidatePath('/team')
  revalidatePath('/cleaning')
  revalidatePath('/tasks')
  return { success: true }
}

export async function updateTeamMemberRole(
  memberId: string,
  newRole: UserRole
): Promise<{ success: boolean; error?: string }> {
  const callerRole = await getCallerRole()
  if (!callerRole || !canDo(callerRole, 'team:manage')) {
    return { success: false, error: 'No autorizado' }
  }
  const supabase = await createClient()
  const { error } = await supabase
    .from('team_members')
    .update({ role: newRole })
    .eq('id', memberId)
  if (error) return { success: false, error: error.message }
  revalidatePath('/cleaning')
  revalidatePath('/tasks')
  return { success: true }
}

export async function deactivateTeamMember(
  memberId: string
): Promise<{ success: boolean; error?: string }> {
  const callerRole = await getCallerRole()
  if (!callerRole || !canDo(callerRole, 'team:manage')) {
    return { success: false, error: 'No autorizado' }
  }
  const supabase = await createClient()
  const { error } = await supabase
    .from('team_members')
    .update({ active: false })
    .eq('id', memberId)
  if (error) return { success: false, error: error.message }
  revalidatePath('/cleaning')
  return { success: true }
}

/**
 * Looks up the email address of a team member by their display name.
 * Used on the login page so users can log in with their name instead of email.
 * Returns null if not found (caller shows a friendly error).
 */
export async function lookupEmailByName(
  name: string
): Promise<{ email: string } | null> {
  // Uses service client so it works without a session (login page context)
  const db = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data } = await db
    .from('team_members')
    .select('email')
    .ilike('name', name.trim())
    .eq('active', true)
    .single()
  return data ? { email: data.email } : null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateTempPassword(): string {
  return `Temp${Math.floor(Math.random() * 90000) + 10000}!`
}
