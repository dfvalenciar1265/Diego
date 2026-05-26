import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { parseISO, differenceInDays } from 'date-fns'

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
