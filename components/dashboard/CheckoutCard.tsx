'use client'
import type { TodayCheckOut } from '@/actions/dashboard'
import { ReservationTimePanel } from './ReservationTimePanel'
import { CheckoutCleaningControl, type CleaningPerson } from './CheckoutCleaningControl'
import type { UserRole } from '@/lib/types'

export function CheckoutCard({ co, role, memberId, people }: { co: TodayCheckOut; role: UserRole; memberId: string; people: CleaningPerson[] }) {
  return <div><ReservationTimePanel key={co.timing.version} timing={co.timing} stay={co.stay} canEdit={role === 'admin'} heading={<>
    <p className="text-sm font-medium text-[#0f172a]">{co.property_name}</p>
    <p className="text-xs text-[#64748b]">{co.guest_name} · <span className="font-semibold text-[#0f172a]">
      {co.guests == null ? 'Huéspedes por confirmar' : `${co.guests} huésped${co.guests === 1 ? '' : 'es'}`}
    </span></p>
  </>} />
    <CheckoutCleaningControl key={`${co.cleaning.task?.status}:${co.cleaning.task?.assigned_to}`} checkout={co} role={role} memberId={memberId} people={people} />
  </div>
}
