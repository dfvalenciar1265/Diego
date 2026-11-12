# E2E operación: Supabase local real, nunca producción

Prueba ejecutada contra Auth/Storage locales reales el 12/11/2026: pasada final conjunta de cinco escenarios correcta (5/5, 15.9 segundos). Docker requiere aceptación del usuario antes de arrancar. CLI consultado: Supabase 3.1.0. Configuración temporal preparada fuera del repo; no contiene credenciales ni enlace remoto.

## Stack aislado

1. Inicializar directorio temporal nuevo con `npx --yes supabase@3.1.0 init --workdir "$STACK"`; no copiar `.env`, `.temp`, seed o enlace de producción. `project_id` único, `auth.site_url` http://127.0.0.1:4100, `db.seed.enabled=false`.
2. Tras autorización de Docker, iniciar desde ese workdir: `npx --yes supabase@3.1.0 start --workdir "$STACK" -x realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`. Mantener gotrue, storage-api, kong, postgrest, mailpit. No ignorar healthchecks.
3. Capturar `status --workdir "$STACK" -o env` en archivo temporal privado modo600, sin imprimir ni adjuntar contenido. Usar solo claves locales: API_URL → NEXT_PUBLIC_SUPABASE_URL, ANON_KEY → NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE_ROLE_KEY → SUPABASE_SERVICE_ROLE_KEY, DB_URL → AIRADMIN_LOCAL_DB_URL. No usar `eval` ni cargar estado no inspeccionado. No reutilizar secretos remotos ni guardar este archivo en Git.
4. En una base recién creada ejecutar `bash scripts/bootstrap-operation-local.sh`. El script permite solo localhost:54322/postgres y aborta si ya existe team_members. No borra ni resetea nada. Completa columnas faltantes del baseline antes de migraciones posteriores. Mantiene auth.uid(), auth.users, Storage y roles REALES; no ejecutar los stubs del runner SQL.
5. Con variables locales exportadas, ejecutar `npx playwright test -c playwright.operation.config.ts`. Puerto4100 aislado, no reutiliza servidor existente. Nunca ejecutar contra .env de producción.

## Cobertura preparada

- Login real por nombre (admin y limpieza) y cookies SSR.
- Usuario Auth válido sin team_members: RLS rechaza lectura/escritura de borradores.
- Administrador: borrador persistido, relectura después de reload, canal pendiente/sin destinatario, ningún envío.
- Aviso interno creado y conservado tras reload, sin publicación exterior.
- Limpieza: checklist registrable, borradores administrativos inaccesibles.
- Sin sesión: redirección a login.

Usuarios, correo example.test, huésped y propiedad son sintéticos. Contraseña aleatoria solo en memoria. No snapshots de sesiones, trazas ni videos con tokens. Los fixtures quedan dentro del stack local para inspección; no se eliminan datos ni volúmenes automáticamente.

## Límites antes de declarar listo

Ejecutado con Auth/Storage reales. Checklist sube PNG sintético por server action y relee con botón de foto privada. Los permisos de descarga/expiración se comprueban en scripts/test-inspection-storage-local.mjs. No se prueba envío externo (intencionalmente inexistente), ni base completa de gastos: expenses local es stub mínimo heredado para compatibilidad de índices. No es migración de reparación de producción ni reemplaza el runner SQL/concurrencia.

## Registro histórico añadido

RPC independiente `record_historical_building_notice` y observaciones integradas al historial. El hecho puede haber ocurrido antes de crear un borrador; conserva `occurred_at` distinto de `recorded_at`, actor, referencia y evidencia. Una entrega no inventa un envío. Se exige verificar contacto por operación separada. La referencia identifica reserva+destino; reintentos idénticos no duplican y payload distinto se rechaza. Cambios de estancia invalidan permanentemente vigencia y conservan evidencia. Observación vigente bloquea preparar otro envío y sus enlaces. No hay publicación externa.

Validación SQL local: `scripts/test-historical-building-observations.sql`,20 asserts y denegaciones. Incluye flujo preparado normal compatible, rechazo del backdate en la ruta antigua, candidato sin promoción, invalidación/restauración y RLS. E2E histórico pasó: candidato sin promover, verificación expresa separada, formulario con entrega sintética de ayer, relectura DB de actor/tiempos, cero avisos preparados inventados, ausencia de enlace de envío y persistencia tras reload. Capturas sintéticas desktop/móvil revisadas; no contienen usuarios reales ni credenciales.
