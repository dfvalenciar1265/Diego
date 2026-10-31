import type { TaskStatus, UserRole } from './types'

export interface CheckoutCleaningTask {
  id: string; property_id: string; reservation_id: string; scheduled_for: string
  status: TaskStatus; assigned_to: string | null; assignee_name: string | null; completed_at: string | null
}
export interface CheckoutCleaningInput {
  reservation_id: string; task_id: string; property_id: string
  stay_check_in: string; stay_check_out: string
  action: 'start' | 'finish'; assigned_to: string
}
export function canOperateCheckoutCleaning(role: UserRole) {
  return ['admin', 'anfitrion', 'cleaning'].includes(role)
}
