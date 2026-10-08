# Servidor MCP de AirAdmin (reemplazo del GPT antes del 11-dic-2026)
**Fecha:** 2026-10-08
**Estado:** Aprobado por Diego ("sí, apruebo, hazlo de corrido")
**Rama:** `claude/mcp-airadmin`
**Antecedente:** `docs/superpowers/specs/2026-10-08-api-chatgpt-design.md` (API `/api/gpt/*` + GPT "AirAdmin")

---

## 1. Por qué

OpenAI retira los GPT personalizados el **11-dic-2026**; sus Acciones no se migran a los nuevos
"complementos": hay que rehacerlas como servidor MCP. El plan Plus de Diego tiene
"Complementos → Añadir → Crear servidor MCP personalizado" (verificado en su cuenta el 8-oct).
ChatGPT solo autentica servidores MCP con **OAuth 2.1** (o sin autenticación); no acepta claves
de API. El mismo servidor sirve para Claude.

## 2. Decisiones

| Decisión | Elección | Razón |
|---|---|---|
| Autenticación | OAuth 2.1 de **Supabase Auth** (beta), con la cuenta de AirAdmin | Elegido por Diego. Reusa el login existente, revocable, sirve para Claude |
| Registro de clientes | Dynamic Client Registration activado en Supabase | ChatGPT lo usa cuando el servidor de autorización no ofrece CIMD |
| Quién puede conectar | Solo `team_members` con `role = 'admin'` y `active = true` | Mismo alcance que el API del GPT |
| Herramientas | Las mismas 6 del GPT, con nombres en snake_case | Paridad; ChatGPT confirma las que escriben |
| Reportado por | Quien está conectado (no siempre Diego) | El token identifica a la persona |
| Paquetes | `mcp-handler@2.3.0`, `@modelcontextprotocol/server@^2.3.1`, `zod@^4.4.3` | Adaptador oficial de Vercel para Next.js; spec MCP 2026-07-28 + compatibilidad 2025 |
| Código compartido | Nuevo `lib/gpt-api/service.ts`; las rutas `/api/gpt/*` y el MCP lo usan | Una sola implementación de cada herramienta |
| API del GPT | Se mantiene hasta el 11-dic-2026 | Diego sigue usando el GPT mientras migra |

## 3. Flujo de conexión

1. ChatGPT: Complementos → Añadir → Crear servidor MCP personalizado → URL
   `https://diegoprueba.vercel.app/api/mcp`, autenticación OAuth.
2. ChatGPT llama a `/api/mcp` sin token → `401` con
   `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/api/mcp"`.
3. Ese documento (RFC 9728) dice: `resource = https://diegoprueba.vercel.app/api/mcp`,
   `authorization_servers = ["https://<ref>.supabase.co/auth/v1"]`.
4. ChatGPT lee los metadatos de Supabase (`/.well-known/oauth-authorization-server/auth/v1`),
   se registra (DCR) y abre la autorización con PKCE S256.
5. Supabase manda al navegador a `https://diegoprueba.vercel.app/oauth/consent?authorization_id=…`.
   Sin sesión, `proxy.ts` lleva a `/login?next=…` y el login vuelve ahí después de entrar.
6. La pantalla "Autorizar" muestra la app que pide acceso, con qué usuario y qué podrá hacer.
   Solo un admin activo ve el botón **Autorizar**; cualquiera puede **Rechazar**.
7. Supabase devuelve a ChatGPT con el código; ChatGPT obtiene el token y lo manda como
   `Authorization: Bearer` en cada llamada al MCP.
8. `/api/mcp` verifica el token con `supabase.auth.getClaims` (firma + vencimiento), exige
   `role = authenticated` y que `sub` sea un admin activo de `team_members`. Si no → `401`.

## 4. Piezas

| Archivo | Qué hace |
|---|---|
| `lib/gpt-api/service.ts` (nuevo) | Una función por herramienta: valida, consulta/escribe y devuelve `{ ok, status, data } \| { ok: false, status, error }`. Incluye `revalidatePath` |
| `lib/gpt-api/http.ts` | + `toResponse(result)` |
| `lib/gpt-api/maintenance.ts` | `createMaintenance` acepta `reportedBy` (si falta, Diego como hoy) |
| `app/api/gpt/**/route.ts` | Pasan a llamar al servicio (misma respuesta que hoy) |
| `lib/mcp/config.ts` (nuevo) | Ruta del documento RFC 9728 y URL del servidor de autorización |
| `lib/mcp/auth.ts` (nuevo) | `buildAuthInfo` (pura), `verifyMcpToken`, `memberFromAuth` |
| `lib/mcp/tools.ts` (nuevo) | `registerTools(server)` con las 6 herramientas + `toToolResult` |
| `lib/mcp/instructions.ts` (nuevo) | Instrucciones del servidor (las del GPT, adaptadas) |
| `app/api/mcp/route.ts` (nuevo) | `withMcpAuth(createMcpHandler(registerTools), verifyMcpToken, { required: true })` |
| `app/.well-known/oauth-protected-resource/api/mcp/route.ts` (nuevo) | Documento RFC 9728 + CORS |
| `app/oauth/consent/page.tsx` (nuevo) | Pantalla "Autorizar" (server component) |
| `actions/oauth.ts` (nuevo) | Server action aprobar/rechazar (re-chequea admin al aprobar) |
| `lib/safe-next.ts` (nuevo) | `safeNextPath`: solo rutas internas para `?next=` (evita redirecciones abiertas) |
| `proxy.ts` | `/.well-known` público; sin sesión → `/login?next=<ruta>`; con sesión en `/login` → `next` |
| `app/(auth)/login/page.tsx` | Después de entrar va a `next` (si es seguro) en vez de siempre a `/` |
| `docs/chatgpt-airadmin.md` | + sección "Conectar como complemento (MCP)" y Claude |

## 5. Herramientas MCP

| Nombre | Lectura | Equivale a |
|---|---|---|
| `list_properties` | sí | `GET /api/gpt/properties` |
| `list_maintenance` | sí | `GET /api/gpt/maintenance` |
| `create_maintenance` | no (idempotente: no duplica) | `POST /api/gpt/maintenance` |
| `update_maintenance` | no | `PATCH /api/gpt/maintenance/{id}` |
| `list_reservations` | sí | `GET /api/gpt/reservations` |
| `compare_reservations` | no (deja/quita notas salvo `dry_run`) | `POST /api/gpt/reservations/compare` |

Las de lectura llevan `readOnlyHint: true`; las demás `destructiveHint: false` (ChatGPT pide
confirmación igual). Los esquemas zod describen tipos; la validación con mensajes en español
sigue en `lib/gpt-api/validate.ts`. Resultado: `structuredContent` = el mismo JSON del API REST;
errores con `isError: true` y el mensaje en español. Un error inesperado no expone detalles.

## 6. Configuración en Supabase (Claude, en el Chrome de Diego, después del deploy)

- Authentication → URL Configuration: confirmar Site URL `https://diegoprueba.vercel.app`.
- Authentication → OAuth Server: activar; Authorization Path `/oauth/consent`; permitir
  registro dinámico de clientes.
- Comprobar `https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1`:
  `registration_endpoint` presente y `S256` en `code_challenge_methods_supported`.

## 7. Seguridad

- Registro dinámico abierto: registrar un cliente no da acceso; hace falta iniciar sesión como
  admin activo y aprobar en "Autorizar". La aprobación se re-chequea en el servidor.
- El MCP vuelve a verificar admin activo en **cada** llamada (si alguien deja de ser admin, pierde
  acceso aunque tenga token).
- Mismos límites de datos que el API del GPT: sin montos, sin códigos de acceso, sin borrados.
- `?next=` solo acepta rutas internas (`/…`, no `//…` ni otro dominio).
- Los tokens nunca se registran en logs.

## 8. Pruebas

- Unitarias: `safeNextPath`; `buildAuthInfo` (rol, admin, activo, sub distinto, scopes, client_id);
  `memberFromAuth`; `toToolResult`; `registerTools` registra las 6 con las anotaciones correctas.
- Local: build con las rutas nuevas; documento RFC 9728; `/api/mcp` sin token y con token falso →
  `401` + `WWW-Authenticate`; `/oauth/consent` sin sesión → `/login?next=…`; regresión del API del
  GPT (lecturas, validaciones, `dry_run`).
- Producción (con Diego): conectar el complemento en ChatGPT; Diego inicia sesión y autoriza;
  probar `list_properties` y `list_maintenance`.

## 9. Fuera de alcance

- Pantalla para ver/revocar conexiones (Supabase tiene `listGrants`/`revokeGrant`; se agrega si hace falta).
- Borrar el API del GPT (después del 11-dic-2026).
- Migrar el GPT con el asistente de OpenAI (las Acciones no se migran; el complemento MCP lo reemplaza).
