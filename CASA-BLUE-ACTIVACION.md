# Activar la búsqueda real de Casa Blue

Estado al 18-oct-2026, comprobado en esta rama (`claude/casa-blue-sync-real`, PR #14).
**La búsqueda por fechas sigue sin funcionar en producción.** La API publicada responde
`unconfigured` con los ocho apartamentos en `unknown`, y todavía exige `guests`. Este documento
dice qué está hecho, qué falta y quién debe hacerlo.

## 1. Qué está instalado, qué está listo y qué falta

| Pieza | Estado |
|---|---|
| Base de datos (Supabase `wrjaodsjlopynpjmjvjk`) | **Aplicada** el 18-oct como `20261018130754_casa_blue_calendar_foundation`. Verificado hoy en lectura: `calendar_sync_runs`, `calendar_events` y `availability_rules` existen y están vacías; `read_casa_blue_availability` responde con 8 apartamentos, sin corrida y `consistent: true`. |
| Historial de migraciones del repo | **Conciliado.** `005`/`006`/`007` se reemplazaron por `supabase/migrations/20261018130754_casa_blue_calendar_foundation.sql`, idéntico al SQL aplicado (SHA-256 `adce1257…`). En Postgres local se comprobó que equivale a 005+006+007: tablas iguales y funciones idénticas. Solo agrega la columna `min_nights_overrides` y permisos explícitos. **No volver a aplicarla.** |
| Código de la API (consulta sin `guests`, lectura en una sola instantánea, corridas que no retroceden, feeds duplicados, cobertura de vecinos) | **Listo en el PR #14, sin desplegar.** Producción sigue con el código del PR #12. |
| Llegada el mismo día | **Conservador.** El preaviso "el mismo día hasta las 8:00 p.m." de Airbnb tiene una hora límite que la tabla no guarda. Por eso, con preaviso 0, una llegada para hoy sale `unknown`, nunca `available`. |
| Ocho calendarios iCal en Vercel | **Falta.** Este Mac no tiene la CLI ni un token de Vercel, así que no se pudo comprobar si las variables existen. El acceso anterior de Codex daba 403. |
| Reglas verificadas | **Borrador listo, no aplicado:** `docs/casa-blue/reglas-borrador-airbnb-2026-10-18.json` (sección 2). Falta que Diego lo revise y resuelva los ajustes por fecha. |
| Sincronización cada 5 minutos | **Falta.** No se pudo comprobar el plan de Vercel. `vercel.json` solo tiene un cron diario. Propuesta: `supabase/proposals/schedule-calendar-sync.sql` (pg_cron + pg_net + Vault). Elegir UNA sola vía para no duplicar el programador. |
| Sitio sin `guests` | **Parche entregado, no instalado:** `integrations/casa-blue-fechas.patch`. El código Astro del sitio no está en este Mac. |

## 2. Reglas leídas en Airbnb (solo lectura, 18-oct-2026)

Calendario → Disponibilidad y Reglas de la casa de cada anuncio:

| slug | mínimo | máximo | preaviso | preparación | ventana | días restringidos | llegada / salida |
|---|---|---|---|---|---|---|---|
| mar-adentro-1305 | 2 | 180 | mismo día (≤ 8 p.m.) | ninguno | 12 meses | ninguno | 15:00 / 11:00 |
| torres-del-lago-1303 | **1–2** | 180 | mismo día (≤ 8 p.m.) | ninguno | **6 meses** | ninguno | 15:00 / 11:00 |
| crespo-1214 | 2 | **365** | mismo día (≤ 8 p.m.) | ninguno | 12 meses | ninguno | 15:00 / 11:00 |
| conquistador-1821 | **1–2** | 180 | mismo día (≤ 8 p.m.) | ninguno | 12 meses | ninguno | 15:00 / 11:00 |
| marina-del-rey-1104 | **1–2** | 180 | mismo día (≤ 8 p.m.) | ninguno | 12 meses | ninguno | 15:00 / 11:00 |
| palmetto-1001 | 2 (base; el resumen no mostró el rango) | 180 | mismo día (≤ 8 p.m.) | ninguno | 12 meses | ninguno | 15:00 / 11:00 |
| tocahagua-1208 | **1–2** | 180 | mismo día (≤ 8 p.m.) | ninguno | 12 meses | ninguno | 15:00 / 11:00 |
| tocahagua-708 | **1–2** | 180 | mismo día (≤ 8 p.m.) | ninguno | 12 meses | ninguno | 15:00 / 11:00 |

"1–2" significa que hay noches con mínimo 1, por ajustes por fecha o conjuntos de reglas. El
borrador deja `date_overrides` en `PENDIENTE` para esos 6, así que `revisar` no lo da por válido.
Hay dos opciones, y las decide Diego:
- Listar esas fechas como `{"from":"…","to":"…","min_nights":1}`.
- Poner `[]` y aceptar que una estadía de 1 noche en esas fechas salga `occupied`. Es un falso
  ocupado, nunca un falso disponible.

Mar Adentro y Crespo muestran solo "2" y ya pasan la validación.

## 3. Pasos de activación (en orden)

1. Revisar y mergear el PR #14. Vercel lo despliega solo. Sin los pasos 2 a 5 sigue respondiendo
   `unconfigured`, pero ya admite consultas sin `guests`.
2. **Calendarios.** En Airbnb, cada anuncio → Calendario → Disponibilidad → Vincula calendarios →
   Conectar con otro sitio web → exportar. Pegar cada enlace .ics DIRECTAMENTE en Vercel → proyecto
   `diegoprueba` → Settings → Environment Variables (Production). Nunca en un chat, el repo ni el HTML.
   `CASA_BLUE_ICAL_MAR_ADENTRO_1305`, `CASA_BLUE_ICAL_TORRES_DEL_LAGO_1303`, `CASA_BLUE_ICAL_CRESPO_1214`,
   `CASA_BLUE_ICAL_CONQUISTADOR_1821`, `CASA_BLUE_ICAL_MARINA_DEL_REY_1104`, `CASA_BLUE_ICAL_PALMETTO_1001`,
   `CASA_BLUE_ICAL_TOCAHAGUA_1208`, `CASA_BLUE_ICAL_TOCAHAGUA_708`.
   Ya deben existir: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `CRON_SECRET` (≥ 32 caracteres).
3. **Cobertura.** `CASA_BLUE_ICAL_COVERAGE_DAYS`: la ventana más corta de los ocho es la del 1303,
   6 meses (180 días), así que nunca más de **180**. Antes de fijarla, comprobar en la primera corrida que
   los feeds publican eventos o bloqueos hasta ese horizonte. La ventana no prueba por sí sola el
   alcance de la exportación. Si no se puede comprobar, poner un valor menor.
4. **Reglas.** Completar el borrador y después:
   `node scripts/availability-rules.mjs revisar docs/casa-blue/reglas-borrador-airbnb-2026-10-18.json`
   → `aplicar … --verificado-por <correo admin>` (simulación) → el mismo comando con `--si`.
   Solo escribe en `availability_rules`.
5. **Programador cada 5 min.** Elegir UNA vía:
   - Supabase: activar pg_cron y pg_net, guardar `CRON_SECRET` en Vault como
     `calendar_sync_cron_secret` (escribiéndolo en el SQL Editor) y correr
     `supabase/proposals/schedule-calendar-sync.sql`.
   - Vercel Pro: agregar el cron `*/5 * * * *` a `vercel.json`.

   Una corrida fallida queda `failed`, conserva el último conjunto coherente y no renueva su antigüedad.
6. **Verificar en producción:**
   - `node scripts/check-casa-blue-availability.mjs <llegada> <salida>` debe responder `ready`.
   - Contrastar dos rangos con el calendario de Airbnb, apartamento por apartamento (sección 4).
   - `SELECT status, verified, data_as_of, coverage_to, error FROM calendar_sync_runs ORDER BY created_at DESC LIMIT 5;`
7. **Sitio.** Aplicar `integrations/casa-blue-fechas.patch` en el proyecto Astro, reconstruir y probar desde
   https://casabluecartagena.com. iCal no es instantáneo: precio, confirmación y pago siguen en Airbnb.
   Si se necesita disponibilidad al instante, hace falta una integración oficial (PMS / channel manager).

## 4. Pruebas ejecutadas el 18-oct-2026 (todas con datos sintéticos y bases locales)

- `npx vitest run`: 342 pruebas en verde, más la integración opcional.
- `tsc` y build sin errores; `eslint` sin errores (6 avisos que ya existían en `__tests__/lib/types.test.ts`).
- `bash scripts/test-migrations.sh`, en Postgres 18 local con la migración real: corrida atómica e
  idempotente, `reservations` sin cambios, corridas inválidas y viejas rechazadas, RLS cerrado a anon,
  instantánea coherente y más de 1000 eventos sin truncar.
- `CASA_BLUE_LOCAL_POSTGRES_TEST=1 CASA_BLUE_LOCAL_POSTGRES_RUNNER=psql npx vitest run __tests__/lib/public-availability/postgres-http.test.ts`:
  API por HTTP contra Postgres real local. Primer rango: 7 disponibles y 1 ocupado. Segundo rango:
  8 disponibles. El comprobador público acepta el primero.
- **Navegador real.** `next dev` con la ruta real, `CASA_BLUE_CORS_DEV_ORIGINS=http://localhost:4321`,
  Postgres local y un emulador local de la RPC. Una página servida desde `http://localhost:4321` consultó
  solo por fechas:

  | slug | 10→13 nov (sintético) | 8→10 nov (sintético) |
  |---|---|---|
  | mar-adentro-1305 | available | available |
  | torres-del-lago-1303 | available | available |
  | crespo-1214 | available | available |
  | conquistador-1821 | available | **occupied** |
  | marina-del-rey-1104 | available | available |
  | palmetto-1001 | **occupied** | available |
  | tocahagua-1208 | available | available |
  | tocahagua-708 | available | available |

  Las dos peticiones fueron 200 con CORS válido. Los enlaces a Airbnb llevan `check_in`/`check_out` de
  cada búsqueda y no incluyen adultos. **Son datos sintéticos, no el contraste con Airbnb**, que queda
  pendiente hasta que existan los calendarios y las reglas (paso 6).
