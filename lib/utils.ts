import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { parseISO, differenceInDays, startOfDay } from 'date-fns'
import type { TaskStatus, MaintenancePriority } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getOccupiedDaysInWeek(
  checkIn: string, checkOut: string,
  weekStart: string, weekEnd: string
): number {
  const ci = parseISO(checkIn)
  const co = parseISO(checkOut)
  const ws = parseISO(weekStart)
  const we = parseISO(weekEnd)
  const start = ci < ws ? ws : ci
  const end = co < we ? co : we
  return Math.max(0, differenceInDays(end, start))
}

export function reservationOverlapsDate(
  checkIn: string, checkOut: string, date: string
): boolean {
  const d = parseISO(date)
  return d >= parseISO(checkIn) && d < parseISO(checkOut)
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' })
    .format(parseISO(date))
}

export function getTaskStatusLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    pending: 'Pendiente',
    in_progress: 'En curso',
    done: 'Completado',
  }
  return labels[status]
}

export function getTaskStatusColor(status: TaskStatus): string {
  const colors: Record<TaskStatus, string> = {
    pending: '#f97316',
    in_progress: '#6366f1',
    done: '#22c55e',
  }
  return colors[status]
}

export function isTaskOverdue(scheduledFor: string, status: TaskStatus): boolean {
  if (status === 'done') return false
  return parseISO(scheduledFor) < startOfDay(new Date())
}

export function getPriorityLabel(priority: MaintenancePriority): string {
  const labels: Record<MaintenancePriority, string> = {
    urgent: 'Urgente',
    normal: 'Normal',
    scheduled: 'Programado',
  }
  return labels[priority]
}

export function getPriorityColor(priority: MaintenancePriority): string {
  const colors: Record<MaintenancePriority, string> = {
    urgent: '#ef4444',
    normal: '#f97316',
    scheduled: '#6366f1',
  }
  return colors[priority]
}
