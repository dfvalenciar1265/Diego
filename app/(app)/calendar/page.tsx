import { getProperties } from '@/actions/properties'
import { getReservations } from '@/actions/reservations'
import { CalendarView } from '@/components/calendar/CalendarView'
import { PageHeader } from '@/components/layout/PageHeader'

export default async function CalendarPage() {
  const [properties, reservations] = await Promise.all([
    getProperties(),
    getReservations(),
  ])

  return (
    <>
      <PageHeader title="Calendario de reservas" />
      <CalendarView properties={properties} reservations={reservations} />
    </>
  )
}
