'use client'
import type { TodayCheckOut } from '@/actions/dashboard'
import { ReservationTimePanel } from './ReservationTimePanel'

export function CheckoutCard({ co, canEdit = false }: { co: TodayCheckOut; canEdit?: boolean }) {
  return <ReservationTimePanel key={co.timing.version} timing={co.timing} stay={co.stay} canEdit={canEdit} heading={<>
    <p className="text-sm font-medium text-[#0f172a]">{co.property_name}</p>
    <p className="text-xs text-[#64748b]">{co.guest_name}</p>
  </>} />
}
