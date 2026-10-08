import { createClient } from '@supabase/supabase-js'

/** Cliente de servicio (salta RLS): solo en el servidor, nunca en el navegador. */
export function serviceDb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export type Db = ReturnType<typeof serviceDb>
