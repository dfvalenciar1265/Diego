/**
 * Hora de salida estándar de todos los apartamentos: 11:00 en Colombia (America/Bogota).
 * Otra hora solo vale si alguien la fijó en la app como excepción (tarea de limpieza "HH:MM|").
 * La hora que traen las notas de la reserva no cuenta: los correos de Airbnb dicen 12pm y las
 * reservas importadas antes del 19-oct-2026 la guardaron así.
 */
export const STANDARD_CHECKOUT = '11:00'
