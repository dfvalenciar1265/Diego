# Inicio: un solo día y corte a las 7:00 p. m.

Propuesta del 1 de noviembre de 2026. Diego confirmó que el corte debe incluir Preparación, Salidas e indicadores. Pendiente revisión y aprobación para publicar.

## Comportamiento y criterios de aceptación

- Antes de las 19:00 en `America/Bogota`, Inicio muestra solo las llegadas, salidas y otras tareas de hoy. Preparación deja de mezclar hoy y mañana.
- Desde las 19:00, esos bloques e indicadores muestran el día siguiente. El aviso «Plan para mañana» incluye el día y la fecha; cada bloque e indicador dice «mañana».
- A medianoche se mantiene el día que se estaba planificando y los rótulos pasan a «hoy». No se adelanta un segundo día.
- Inicio abierto se actualiza en el corte y en medianoche. Al volver del segundo plano o recuperar conexión comprueba si debe cambiar de día. No se agregan tareas programadas de Vercel ni consultas periódicas de datos.
- Mientras se edita, guarda o hay un error al guardar la nota de preparación se pospone el cambio automático. El botón manual de actualizar sigue disponible.
- El plan nocturno muestra el estado y responsable de limpieza. Iniciar y terminar permanecen bloqueados para las salidas de mañana; el servicio sigue validando el día real colombiano. Las tareas de hoy siguen accesibles en Limpieza y Tareas.
- Horas, huéspedes e incidencias continúan junto a cada llegada. Los cobros, solicitudes y alertas existentes mantienen sus criterios operativos. `preparationArrivals` conserva la ventana predeterminada de dos días para sus otros lectores; Inicio pide explícitamente un solo día.

## Archivos

- `lib/dashboard-day.ts`: fecha que muestra Inicio y próximo cambio, a las 19:00 o medianoche.
- `app/(app)/page.tsx`, `lib/dashboard-summary.ts`: consultas, filtros, indicadores y rótulos del mismo día.
- `lib/gpt-api/preparation.ts`: límite final opcional de la consulta, compatible con sus lectores anteriores.
- `components/dashboard/RefreshButton.tsx`: actualización del corte y comprobación al recuperar foco/visibilidad/conexión, con limpieza de listeners y temporizador.
- `components/dashboard/{CheckoutCard,CheckoutCleaningControl,DashboardPrepCard}.tsx`: estado de planificación y protección de la nota ante el cambio automático.
- Pruebas nuevas de `dashboard-day`, `DashboardPage` y `RefreshButton`, y ampliaciones de limpieza y preparación.

## Resultados reales

- `npx vitest run`: **565 aprobadas, una opcional omitida**. La omitida es la prueba HTTP de disponibilidad con Postgres, ajena a esta pantalla.
- `TZ=Asia/Tokyo npx vitest run __tests__/lib/dashboard-day.test.ts __tests__/components/DashboardPage.test.tsx`: **15 aprobadas**. Confirma que el reloj del servidor no sustituye el día colombiano.
- `npx tsc --noEmit -p .`: **sin errores**, después de corregir el tipado de dos fixtures de pruebas.
- `npx eslint`: **cero errores y los seis avisos anteriores** de tipos no utilizados.
- Build con `NEXT_PUBLIC_SUPABASE_URL=https://example.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy`: **correcto**, 30 páginas generadas.
- Diff revisado y `git diff --check`: **correcto**.
- Integración de la página con `fake-db`: antes/después del corte, medianoche, indicadores coherentes, cancelaciones fuera de la lista y los cuatro roles. Pruebas existentes de duplicados, reintentos, concurrencia, permisos y cambios de estancia también pasaron.
- Playwright local con página/componentes reales, lecturas y escrituras simuladas, datos sintéticos y conexiones externas bloqueadas: **cinco comprobaciones aprobadas**. Antes/después de las 19:00, medianoche, corte automático con la página abierta y rol de limpieza. Escritorio de 1120 y móvil de 393/320 píxeles sin desbordamiento; cero errores de página. Las capturas muestran únicamente datos sintéticos.

## Límites y pendientes

No se ha mergeado ni publicado esta propuesta. No se probaron reservas reales, sesiones del equipo ni teléfono físico, ni se esperó a un corte nocturno real: el reloj se simuló en las pruebas. El navegador integrado no estaba disponible; se usó Playwright del proyecto en un navegador aislado.

No hay migraciones, cambios de esquema ni escrituras nuevas. La ampliación de preparación es una lectura con el mismo filtro de fecha existente. No se ejecutó la suite de migraciones SQL en esta fase; se usaron `fake-db` y las pruebas de servicio. Producción, Gmail y los pendientes de conciliación anteriores siguen fuera de este cambio.

## Publicación y recuperación

Tras revisar la vista previa y recibir el sí de Diego, mergear el PR con `info-softop` y comprobar el despliegue automático de Vercel. No hay migraciones que aplicar. Verificar en la pantalla publicada la fecha, los rótulos y los indicadores, y observar el próximo corte real a las 19:00 de Colombia. No iniciar ni terminar limpiezas reales como prueba.

Para recuperar la presentación anterior basta revertir el commit y publicar con aprobación. Este cambio no modifica fechas de reservas, estados de tareas ni historiales.
