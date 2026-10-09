# ChatGPT ↔ AirAdmin

Cómo conectar tu GPT "AirAdmin" a la app para manejar mantenimiento y revisar que las reservas
de Airbnb coincidan con la app. Diseño: `docs/superpowers/specs/2026-10-08-api-chatgpt-design.md`.

## 0. Recomendado: conectar AirAdmin como complemento (MCP)

OpenAI retira los GPT personalizados el **11 de diciembre de 2026**. El reemplazo es el servidor
MCP de la app, que hace lo mismo que el GPT y además sabe quién está conectado.

**En ChatGPT (una sola vez):**
1. **Complementos** → **Añadir** → **Crear servidor MCP personalizado**.
2. Nombre `AirAdmin`, descripción `Mantenimiento y revisión de reservas de mis apartamentos`.
3. Conexión: punto público `https://diegoprueba.vercel.app/api/mcp`. Autenticación: **OAuth**.
4. Acepta el aviso y **Crear como complemento**.
5. ChatGPT abre AirAdmin: inicia sesión con tu nombre y contraseña y pulsa **Autorizar**.

**En Claude:** Configuración → Conectores → Añadir conector personalizado → la misma URL; al
conectar, inicia sesión y autoriza igual.

Solo los **administradores** de AirAdmin pueden conectarse. ChatGPT te pide confirmar antes de
cada herramienta que escribe (crear o cerrar pendientes, dejar notas). Las herramientas se llaman
`list_properties`, `list_maintenance`, `create_maintenance`, `update_maintenance`,
`list_reservations` y `compare_reservations`; el uso diario (secciones 4 y 5) es igual que con el GPT.

Las secciones 1 a 3 son del GPT anterior, que sigue funcionando hasta el 11 de diciembre.

## 1. Poner la clave en Vercel (una sola vez)

1. Vercel → proyecto de la app → **Settings → Environment Variables**.
2. Nombre `GPT_API_KEY`, valor = la clave que te pasó Claude, entorno **Production**. Guardar.
3. **Deployments** → último deploy de producción → **⋯ → Redeploy** (la variable nueva solo se lee al desplegar).
4. Comprobar: abrir `https://diegoprueba.vercel.app/api/gpt/properties` en el navegador debe responder
   `{"error":"Clave del API inválida o ausente."}` (401). Si dice "no está configurado", falta el paso 3.

## 2. Crear el GPT (una sola vez)

1. ChatGPT → **GPT** → **Crear** → pestaña **Configurar**.
2. Nombre: `AirAdmin`. Descripción: `Mantenimiento y revisión de reservas de mis apartamentos`.
3. **Instrucciones**: pegar el bloque de la sección 3.
4. **Funcionalidades**: desmarcar todo (no necesita búsqueda web, imágenes ni código).
5. **Acciones → Crear nueva acción**:
   - **Importar desde URL**: `https://diegoprueba.vercel.app/api/gpt/openapi.json`
   - **Autenticación**: Clave de API → Tipo de autenticación **Bearer** → pegar la clave.
   - **Política de privacidad**: `https://diegoprueba.vercel.app` (ChatGPT pide una URL; el GPT es privado).
6. **Crear** → visibilidad **Solo yo**. No publicarlo en la tienda de GPT.

Si un día cambias la clave: cámbiala en Vercel (y redeploy) y en la acción del GPT. La vieja deja de servir.

## 3. Instrucciones del GPT (pegar tal cual)

```
Eres AirAdmin, el asistente de Diego para sus apartamentos de Airbnb en Cartagena. Habla siempre en español.

APARTAMENTOS
- Usa siempre los nombres exactos que devuelve listProperties. Si Diego nombra un apartamento de otra forma (título de Airbnb, edificio), tradúcelo a ese nombre; si dudas, pregúntale.

MANTENIMIENTO
- Antes de crear un pendiente, consulta los abiertos de ese apartamento con listMaintenance para no repetir.
- Prioridad: urgent = afecta la estadía (bichos, aire, agua, olor, seguridad, electricidad); normal = desgaste (lencería, pintura, cajones, puertas, muebles); scheduled = fotos o ficha.
- No cargues quejas de ubicación (ruido de la calle) ni cosas que ya están arregladas.
- Antes de crear un pendiente o cambiar su estado, muéstrale a Diego exactamente qué vas a hacer y espera su "sí".
- Antes de decir que algo está roto o arreglado, consulta su estado en la app.
- Si marcas "resolved" un preventivo recurrente (fumigación, aires), la app no lo cierra: anota hoy como última vez y avanza la próxima fecha. Explícaselo así a Diego con la nueva fecha.

REVISIÓN DE RESERVAS
- Diego te pega la lista que sacó de Airbnb con el modo agente. Conviértela a compareReservations: from y to (AAAA-MM-DD) y una entrada por reserva con code (HM…), guest_name, property (nombre de la app), check_in, check_out, guests y status (confirmed o cancelled).
- Si la lista no trae el año, usa el que corresponda a fechas próximas a hoy.
- Si Diego dice "solo mirar", envía dry_run: true (no deja notas en la app).
- Muestra el resultado en una tabla: apartamento, huésped, código y qué difiere. Después, lo que no se pudo emparejar y por qué.
- missing_in_app: sugiere correr la sincronización de Gmail en la app (Ajustes → Gmail).
- not_in_airbnb_list: puede ser que el agente no la haya leído; pide verificarla en Airbnb antes de concluir que se canceló.
- Nunca digas que corregiste reservas: el API solo deja la nota "⚠️ Diferencia con Airbnb" en la reserva de la app.

REGLAS
- Nunca inventes arreglos, fechas ni datos. Si algo no está en la app, dilo.
- Si una acción responde con error, explícale el mensaje a Diego en palabras simples.
```

## 4. Revisar reservas (cada vez)

**Paso A — en ChatGPT, modo agente** (no en el GPT): pegar este texto, cambiando las fechas.

```
Entra a Airbnb (airbnb.com.co) con mi sesión → modo anfitrión → Reservaciones. Revisa todas las
reservas que tengan noches entre el 2026-10-08 y el 2026-12-07, incluidas las que están en curso
y las canceladas de ese rango. Recorre todas las pestañas (próximas, en curso, canceladas) y todas
las páginas.

Solo lee: no escribas mensajes, no aceptes ni cambies nada.

Devuélveme UNA tabla en texto plano, una fila por reserva, con estas columnas separadas por punto y coma:
código;huésped;anuncio;llegada (AAAA-MM-DD);salida (AAAA-MM-DD);huéspedes;estado (confirmada/cancelada)

Al final escribe cuántas reservas listaste y si alguna página no cargó.
```

**Paso B — en el GPT AirAdmin**: «Compara estas reservas del 2026-10-08 al 2026-12-07:» y pegar la tabla.

El GPT responde con las diferencias. Las reservas con diferencia quedan con la nota
`⚠️ Diferencia con Airbnb (fecha): …` en la app; cuando vuelvan a coincidir, la nota se borra sola
en la siguiente revisión. También la puedes borrar a mano en el formulario de la reserva.

## 5. Mantenimiento (cada vez)

Directo en el GPT AirAdmin, por ejemplo:
- «¿Qué pendientes abiertos tiene Palmetto 1001?»
- «Carga en Tocahagua 1208: la puerta del balcón está dura, prioridad normal.»
- «Ya se arregló el desagüe de Palmetto; costó 80.000. Ciérralo.»
- «Ya se fumigó Conquistador hoy.» (preventivo: avanza la próxima fecha)

## Qué puede y qué no puede hacer

| Puede | No puede |
|---|---|
| Ver apartamentos, pendientes y reservas (sin montos) | Ver códigos de acceso, montos o correos |
| Crear pendientes (sin duplicar) | Borrar nada |
| Cambiar estado, agregar notas y costo a pendientes | Reasignar pendientes |
| Dejar o quitar la nota de diferencia en reservas | Cambiar fechas, huéspedes, tareas o montos de reservas |
