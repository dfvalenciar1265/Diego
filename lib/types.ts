export type UserRole = 'admin' | 'cleaning' | 'maintenance' | 'anfitrion'

export interface TeamMember {
  id: string
  name: string
  email: string
  role: UserRole
  active: boolean
  created_at: string
}

export interface Property {
  id: string
  name: string
  address: string
  access_code: string
  instructions: string
  capacity: number
  photos: string[]
  active: boolean                // whether property is shown in the app
  created_at: string
}

export type ReservationSource = 'airbnb' | 'direct'
export type ReservationStatus = 'confirmed' | 'blocked' | 'cancelled'

export interface Reservation {
  id: string
  property_id: string
  source: ReservationSource
  guest_name: string
  check_in: string        // ISO date YYYY-MM-DD
  check_out: string       // ISO date YYYY-MM-DD
  amount: number
  guests: number | null
  notes: string
  status: ReservationStatus
  created_at: string
}

export type TaskType = 'cleaning' | 'preparation' | 'other'
export type TaskStatus = 'pending' | 'in_progress' | 'done'

export interface Task {
  id: string
  property_id: string
  reservation_id: string | null
  type: TaskType
  assigned_to: string | null     // team_member id
  scheduled_for: string          // ISO date
  status: TaskStatus
  notes: string
  photo_url: string | null
  completed_at: string | null
  cost: number | null            // optional cost (e.g. for misc tasks)
  created_at: string
}

export type MaintenancePriority = 'urgent' | 'normal' | 'scheduled'
export type MaintenanceStatus = 'open' | 'in_progress' | 'resolved'

export interface MaintenanceIssue {
  id: string
  property_id: string
  title: string
  description: string
  photo_url: string | null
  priority: MaintenancePriority
  status: MaintenanceStatus
  assigned_to: string | null     // team_member id
  cost: number | null
  reported_by: string            // team_member id
  resolved_at: string | null
  notes: string
  created_at: string
}

export interface Supply {
  id: string
  name: string
  unit: string
  created_at: string
}

export interface PropertySupply {
  id: string
  property_id: string
  supply_id: string
  current_qty: number
  min_qty: number
  updated_by: string
  updated_at: string
  supply?: Supply              // join opcional
}

export type PurchaseStatus = 'pending' | 'purchased'

export interface PurchaseRequest {
  id: string
  property_id: string
  supply_id: string | null
  description: string
  requested_by: string
  status: PurchaseStatus
  resolved_by: string | null
  created_at: string
  property?: Property          // join opcional
  supply?: Supply              // join opcional
}

export type ExpenseStatus = 'pending' | 'paid'

export interface Expense {
  id: string
  property_id: string
  provider: string
  date: string          // ISO date YYYY-MM-DD
  amount: number
  status: ExpenseStatus
  notes: string | null
  created_at: string
  property?: { name: string }
}

// Tipos para el Dashboard
export interface DashboardKPIs {
  checkInsToday: number
  checkOutsToday: number
  pendingTasks: number
  monthlyRevenue: number
}

export interface OccupancyData {
  property: Property
  daysOccupied: number
  totalDays: number
}
