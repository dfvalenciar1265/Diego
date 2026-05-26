# AirAdmin — Plataforma de Gestión Airbnb
**Fecha:** 2026-05-26  
**Estado:** Aprobado  
**Tipo:** MVP — Fase 1

---

## 1. Contexto y Problema

Diego administra entre 4–10 apartamentos de Airbnb con un equipo pequeño (limpieza y mantenimiento). Actualmente usa hojas de cálculo (Google Sheets) y WhatsApp para coordinar operaciones. Tiene reservas en Airbnb y también directas.

**Dolores principales:**
- Coordinación de limpieza y mantenimiento sin sistema centralizado
- Control manual de insumos por apartamento
- Sin visibilidad clara del estado de todos los aptos en tiempo real
- El equipo no tiene una forma estándar de reportar incidencias o faltantes

**Éxito:** Diego puede abrir la app cada mañana y saber en 10 segundos qué está pasando hoy en todos sus aptos.

---

## 2. Decisiones de Diseño

| Decisión | Elección | Razón |
|---|---|---|
| Tipo de plataforma | PWA (Progressive Web App) | Instalable sin App Store, push notifications, cámara, deploy instantáneo |
| Enfoque | MVP primero, crecer después | Evita construir features no validados |
| Uso predominante | Mobile-first (90% móvil) | Bottom nav, touch targets 44px+, cards scroll horizontal |
| Estilo visual | Light & Clean (Airbnb-inspired) | Coral #ff385c, fondo blanco/gris, Inter, sombras suaves |
| Canales de reserva | Airbnb + reservas directas | Carga manual en MVP, sync automático en Fase 2 |

---

## 3. Módulos del MVP

### 3.1 Dashboard General
Vista principal que el admin ve cada mañana.

**Contenido:**
- KPIs del día: check-ins hoy, check-outs hoy, tareas pendientes, ingreso del mes
- Ocupación de la semana por apartamento (barras de progreso)
- Lista de tareas de hoy con responsable y estado
- Alertas de stock bajo de insumos

**Comportamiento:**
- KPIs en tarjetas horizontales con scroll en móvil
- Código de color: 🔴 urgente, 🟠 pendiente, 🟢 completado
- Saludo personalizado con nombre del usuario logueado

---

### 3.2 Calendario de Reservas
Vista mensual de ocupación por apartamento.

**Contenido:**
- Vista de grilla: apartamentos en filas, días en columnas
- Bloques de color por reserva (Airbnb vs directa)
- Detalle de reserva al tocar: nombre huésped, fechas, notas
- Bloqueos manuales (limpieza, mantenimiento, uso propio)

**Operaciones:**
- Crear reserva directa (nombre, fechas, monto, notas)
- Crear bloqueo manual
- Editar o eliminar reserva/bloqueo
- Ver check-ins y check-outs del día seleccionado

---

### 3.3 Gestión de Tareas (Limpiezas)
Coordinación de limpiezas del equipo.

**Contenido:**
- Lista de tareas por fecha, con filtro por apartamento y responsable
- Cada tarea: tipo (limpieza/preparación), apto, hora, responsable, estado
- Vista del equipo: solo sus tareas asignadas para hoy

**Operaciones:**
- Crear tarea manual o automática post-check-out
- Asignar responsable (miembro del equipo)
- Cambiar estado: pendiente → en curso → completado
- Agregar nota o foto al completar

**Automatización MVP:**
- Al cargar un check-out, el sistema sugiere crear tarea de limpieza automáticamente

---

### 3.4 Mantenimiento e Incidencias
Gestión de problemas y reparaciones por apartamento.

**Contenido:**
- Lista de incidencias abiertas y cerradas
- Cada incidencia: apartamento, descripción, foto, prioridad, asignado, estado, costo
- Filtro por estado (abierto/en proceso/resuelto) y prioridad

**Prioridades:** 🔴 Urgente · 🟡 Normal · 🔵 Programado

**Estados:** Abierto → En proceso → Resuelto

**Operaciones:**
- Crear incidencia desde cualquier rol (con foto opcional)
- Admin: asignar a técnico, cambiar prioridad, registrar costo
- Técnico: actualizar estado, agregar notas de resolución
- Limpieza: solo puede crear (reportar), no gestionar

**Historial:** Cada apartamento tiene historial completo de mantenimientos con costos acumulados.

---

### 3.5 Propiedades + Stock de Insumos
Ficha de cada apartamento con gestión de inventario.

**Datos de la propiedad:**
- Nombre, dirección, fotos
- Código de acceso / instrucciones de entrada
- Instrucciones para el equipo (WiFi, reglas especiales, etc.)
- Capacidad, número de llaves

**Stock de insumos (por apartamento):**
- Lista de productos con cantidad actual y mínimo definido
- Cuando cantidad ≤ mínimo → alerta en Dashboard
- La limpiadora actualiza stock con botones +/− al limpiar
- Historial de actualizaciones de stock

---

### 3.6 Solicitudes de Compra
Flujo para reportar y resolver faltantes.

**Flujo:**
1. Cualquier miembro del equipo envía solicitud ("Falta X en Apto Y")
2. Aparece en sección "Compras pendientes" del Dashboard del admin
3. Admin marca "Comprado" cuando lo resuelve
4. El stock del apto se actualiza al entregar

**Integrado con:** Alertas de stock bajo (se generan automáticamente cuando hay alerta)

---

## 4. Roles y Permisos

| Módulo | Admin | Limpieza | Mantenimiento |
|---|---|---|---|
| Dashboard completo | ✅ | ❌ | ❌ |
| Calendario (ver) | ✅ | ✅ (solo fechas) | ✅ (solo fechas) |
| Calendario (editar) | ✅ | ❌ | ❌ |
| Tareas (todas) | ✅ | ❌ | ❌ |
| Tareas (propias) | ✅ | ✅ | ✅ |
| Mantenimiento (gestionar) | ✅ | ❌ | ✅ (propios) |
| Mantenimiento (reportar) | ✅ | ✅ | ✅ |
| Propiedades (editar) | ✅ | ❌ | ❌ |
| Propiedades (ver) | ✅ | ✅ (su info) | ✅ (su info) |
| Stock (actualizar) | ✅ | ✅ | ❌ |
| Solicitudes de compra | ✅ | ✅ (crear) | ✅ (crear) |
| Equipo (gestionar) | ✅ | ❌ | ❌ |

---

## 5. Stack Tecnológico

| Capa | Tecnología | Razón |
|---|---|---|
| Framework | Next.js 15 (App Router) | PWA nativo, SSR, API routes integradas |
| Lenguaje | TypeScript | Tipado, menos bugs en producción |
| Base de datos | Supabase (PostgreSQL) | Auth + DB + Storage en uno, generous free tier |
| Autenticación | Supabase Auth | Email/password + magic link |
| Almacenamiento de fotos | Supabase Storage | Fotos de mantenimiento e insumos |
| UI Components | shadcn/ui + Radix | Accesibles, personalizables, mobile-friendly |
| Estilos | Tailwind CSS v4 | Utility-first, excelente para mobile-first |
| Deploy | Vercel | CI/CD automático, edge network, integración nativa con Next.js |
| PWA | next-pwa / next-service-worker | Service worker, manifest, instalabilidad |

---

## 6. Modelo de Datos (Esquema Principal)

```sql
-- Propiedades
properties: id, name, address, access_code, instructions, capacity, photos[], created_at

-- Equipo
team_members: id, name, email, role (admin|cleaning|maintenance), active, created_at

-- Reservas
reservations: id, property_id, source (airbnb|direct), guest_name, check_in, check_out, 
              amount, notes, status, created_at

-- Tareas
tasks: id, property_id, reservation_id?, type (cleaning|preparation|other), 
       assigned_to, scheduled_for, status (pending|in_progress|done), 
       notes, completed_at, created_at

-- Mantenimiento
maintenance: id, property_id, title, description, photo_url?, priority (urgent|normal|scheduled),
             status (open|in_progress|resolved), assigned_to?, cost?, 
             reported_by, resolved_at?, notes, created_at

-- Insumos
supplies: id, name, unit (unidad|rollo|litro|etc), created_at

-- Stock por apartamento
property_supplies: id, property_id, supply_id, current_qty, min_qty, updated_by, updated_at

-- Solicitudes de compra
purchase_requests: id, property_id, supply_id?, description, requested_by, 
                   status (pending|purchased), resolved_by?, created_at
```

---

## 7. Diseño Visual

**Paleta de colores:**
- Primario: `#ff385c` (coral Airbnb) — acciones principales, active state
- Fondo: `#f8fafc` — fondo general
- Cards: `#ffffff` con `box-shadow: 0 1px 3px rgba(0,0,0,0.06)`
- Bordes: `#e2e8f0`
- Texto principal: `#0f172a`
- Texto secundario: `#94a3b8`
- Urgente: `#ef4444`
- Pendiente: `#f97316`
- Completado: `#22c55e`

**Tipografía:** Inter (Google Fonts)

**Navegación:** Bottom navigation bar con 5 ítems (Admin) / 3 ítems (Equipo)

**Touch targets:** Mínimo 44×44px en todos los elementos interactivos

**Cards:** Border-radius 12px, sombra sutil, padding 16px

---

## 8. Flujos Críticos

### Check-out → Limpieza
```
Check-out registrado → Sistema sugiere crear tarea de limpieza
→ Admin confirma o ajusta → Tarea asignada a limpiadora
→ Limpiadora ve tarea en su vista → Inicia → Actualiza stock insumos
→ Marca como completada → Admin ve ✅ en dashboard
```

### Incidencia de Mantenimiento
```
Cualquier rol reporta incidencia (+ foto opcional)
→ Admin recibe alerta en dashboard → Asigna técnico + prioridad
→ Técnico ve en su vista → Actualiza estado → Registra resolución
→ Admin marca como resuelta → Queda en historial del apto
```

### Stock bajo → Compra
```
Limpiadora actualiza stock al limpiar → Cantidad ≤ mínimo
→ Alerta automática en dashboard admin → Admin compra
→ Marca como comprado → Stock actualizado al entregar
```

---

## 9. Alcance Fase 2 (Post-MVP)

- Mensajería con huéspedes (integración con Airbnb inbox)
- Módulo financiero completo (ingresos, gastos, rentabilidad por apto)
- Reportes avanzados (ocupación mensual, análisis de costos, ROI)
- Notificaciones push reales + integración WhatsApp (Twilio)
- Sincronización automática calendario Airbnb (iCal o API)
- Aplicación de escritorio (dashboard ampliado para admins)

---

## 10. Criterios de Éxito del MVP

- [ ] Admin puede ver estado de todos sus aptos en < 10 segundos al abrir la app
- [ ] Limpiadora recibe y completa tareas sin necesidad de WhatsApp
- [ ] Incidencias quedan registradas con foto y asignación en < 1 minuto
- [ ] Stock bajo dispara alerta antes de que un huésped llegue y falte algo
- [ ] Equipo instala la PWA en su teléfono sin fricción (< 30 segundos)

---

## 11. Estimación de Tiempo

| Fase | Descripción | Tiempo |
|---|---|---|
| Setup | Next.js + Supabase + PWA + Auth | 3–4 días |
| Core | Propiedades + Calendario + Reservas | 1 semana |
| Operaciones | Tareas + Mantenimiento | 1 semana |
| Insumos | Stock + Solicitudes de compra | 3–4 días |
| Roles y permisos | Vistas por rol | 3–4 días |
| Dashboard | KPIs + alertas integradas | 3–4 días |
| Polish | Mobile UX, PWA, testing | 1 semana |
| **Total estimado** | | **4–6 semanas** |
