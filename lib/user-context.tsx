'use client'
/**
 * Provides the current user's role to all client components via React context.
 * Set once in the (app) layout Server Component → no per-component DB round-trips.
 */
import { createContext, useContext } from 'react'
import type { UserRole } from './types'

const UserRoleContext = createContext<UserRole | null>(null)

export function UserRoleProvider({
  role,
  children,
}: {
  role: UserRole | null
  children: React.ReactNode
}) {
  return <UserRoleContext.Provider value={role}>{children}</UserRoleContext.Provider>
}

export function useUserRole(): UserRole | null {
  return useContext(UserRoleContext)
}
