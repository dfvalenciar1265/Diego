import type { SyncResult } from './types'

/** Parcial no certifica todo al día, pero paginación y discrepancias tampoco son fallos de conexión. */
export function gmailNotice(result: SyncResult): { tone: 'success' | 'warning' | 'error'; label: string; message: string } {
  if (result.state === 'complete') return { tone: 'success', label: 'Gmail', message:
    `Lectura completa: ${result.new_count ?? 0} reservas nuevas y ${result.updated_count ?? 0} cambios para revisar.` }
  if (result.state === 'busy') return { tone: 'warning', label: 'En curso', message: 'Ya hay una importación en curso. Consulta su estado antes de repetir.' }
  if (result.state !== 'partial' || (result.error_code && !['source_incomplete', 'deadline'].includes(result.error_code))) {
    return { tone: 'error', label: 'Error', message: result.error ?? 'No se completó la importación. Se conservan los datos anteriores.' }
  }
  if (result.scan_complete === false || result.error_code === 'source_incomplete' || result.error_code === 'deadline') {
    return { tone: 'warning', label: 'Por continuar', message: 'Lectura por partes: queda trabajo pendiente. La próxima corrida continúa el mismo alcance.' }
  }
  return { tone: 'warning', label: 'Por revisar', message: result.scan_complete === true
    ? `Se terminó de leer el alcance. Quedan ${result.pending_count ?? 'algunos'} correos y ${result.duplicate_task_groups ?? 0} grupos de tareas por revisar; no significa que falten esas reservas.`
    : 'Hay pendientes de conciliación. Consulta el alcance y su estado.' }
}
