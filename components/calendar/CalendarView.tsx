'use client'
import { useState } from 'react'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  addMonths, subMonths
} from 'date-fns'
import { es } from 'date-fns/locale'
import type { Property, Reservation } from '@/lib/types'
import { reservationOverlapsDate } from '@/lib/utils'
import { ReservationForm } from './ReservationForm'

interface Props {
  properties: Property[]
  reservations: Reservation[]
}

export function CalendarView({ properties, reservations }: Props) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [selectedPropertyId, setSelectedPropertyId] = useState('')

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  })

  function getReservationForDay(propertyId: string, date: Date): Reservation | null {
    const dateStr = format(date, 'yyyy-MM-dd')
    return reservations.find(r =>
      r.property_id === propertyId &&
      reservationOverlapsDate(r.check_in, r.check_out, dateStr)
    ) ?? null
  }

  function openNew(propertyId: string) {
    setSelectedReservation(null)
    setSelectedPropertyId(propertyId)
    setFormOpen(true)
  }

  function openEdit(res: Reservation) {
    setSelectedReservation(res)
    setSelectedPropertyId(res.property_id)
    setFormOpen(true)
  }

  function handleClose() {
    setFormOpen(false)
    setSelectedReservation(null)
    setSelectedPropertyId('')
  }

  return (
    <div className="overflow-x-auto pb-4">
      {/* Navegación de mes */}
      <div className="flex items-center justify-between px-4 py-3 sticky left-0 bg-[#f8fafc]">
        <button
          onClick={() => setCurrentMonth(m => subMonths(m, 1))}
          className="w-10 h-10 flex items-center justify-center text-[#94a3b8] text-xl"
          aria-label="Mes anterior"
        >‹</button>
        <span className="font-semibold text-[#0f172a] capitalize">
          {format(currentMonth, 'MMMM yyyy', { locale: es })}
        </span>
        <button
          onClick={() => setCurrentMonth(m => addMonths(m, 1))}
          className="w-10 h-10 flex items-center justify-center text-[#94a3b8] text-xl"
          aria-label="Mes siguiente"
        >›</button>
      </div>

      {/* Grilla scrolleable horizontalmente */}
      <div style={{ minWidth: `${Math.max(600, days.length * 36 + 80)}px` }}>
        {/* Encabezado de días */}
        <div className="flex" style={{ marginLeft: 80 }}>
          {days.map(day => (
            <div key={day.toISOString()}
                 className="w-9 flex-shrink-0 text-center text-[10px] text-[#94a3b8] py-1 font-medium">
              {format(day, 'd')}
            </div>
          ))}
        </div>

        {/* Una fila por propiedad */}
        {properties.map(property => (
          <div key={property.id} className="flex items-center border-t border-[#f1f5f9]">
            <div className="w-20 flex-shrink-0 px-2 py-2">
              <p className="text-xs font-medium text-[#0f172a] truncate">{property.name}</p>
            </div>
            {days.map(day => {
              const res = getReservationForDay(property.id, day)
              const dateStr = format(day, 'yyyy-MM-dd')
              const isCheckIn = res?.check_in === dateStr

              return (
                <div
                  key={day.toISOString()}
                  className="w-9 flex-shrink-0 h-9 relative border-l border-[#f1f5f9] cursor-pointer"
                  onClick={() => res ? openEdit(res) : openNew(property.id)}
                >
                  {res && (
                    <div
                      className="absolute inset-1 rounded text-[9px] flex items-center
                                 justify-center font-medium select-none"
                      style={{
                        backgroundColor: res.source === 'airbnb' ? '#ff385c' : '#6366f1',
                        color: 'white',
                        borderRadius: isCheckIn ? '4px 0 0 4px' : '0',
                      }}
                    >
                      {isCheckIn ? '→' : ''}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}

        {properties.length === 0 && (
          <div className="text-center py-12 text-[#94a3b8] text-sm">
            No hay apartamentos registrados
          </div>
        )}
      </div>

      {/* Leyenda */}
      <div className="flex gap-4 px-4 pt-3">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-[#ff385c]" />
          <span className="text-xs text-[#94a3b8]">Airbnb</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-[#6366f1]" />
          <span className="text-xs text-[#94a3b8]">Directa</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-[#94a3b8]" />
          <span className="text-xs text-[#94a3b8]">Bloqueado</span>
        </div>
      </div>

      <ReservationForm
        open={formOpen}
        onClose={handleClose}
        reservation={selectedReservation ?? undefined}
        propertyId={selectedPropertyId}
        properties={properties}
      />
    </div>
  )
}
