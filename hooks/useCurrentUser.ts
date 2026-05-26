'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { TeamMember } from '@/lib/types'

export function useCurrentUser() {
  const [member, setMember] = useState<TeamMember | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    async function load() {
      setLoading(true)

      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return

      if (!user) {
        setMember(null)
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .eq('id', user.id)
        .single()

      if (cancelled) return

      if (error && error.code !== 'PGRST116') {
        console.error('Failed to fetch team member:', error)
      }

      setMember(data ?? null)
      setLoading(false)
    }

    load()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      load()
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  return { member, loading }
}
