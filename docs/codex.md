# Trabajar AirAdmin con Codex

Codex lee las instrucciones de `AGENTS.md`, el de la raíz del repo y los de las subcarpetas.
Claude Code lee las mismas a través de `CLAUDE.md` (`@AGENTS.md`), así que las reglas viven en
un solo lugar. Si cambia una regla, se cambia en `AGENTS.md`.

## 1. Lo que ya quedó listo

| Archivo | Para qué |
|---|---|
| `AGENTS.md` (repo) | Comandos, mapa del código, reglas del negocio, seguridad y forma de trabajar |
| `~/.codex/AGENTS.md` (tu Mac, fuera del repo) | Tus preferencias globales: español, `info-softop`, navegador, seguridad y dónde está el contexto de Airbnb |
| `docs/codex.md` | Esta guía |

El contexto privado de la operación (apartamentos, equipo, arreglos confirmados, reglas de
reseñas) **no** se sube al repo. Codex lo lee desde
`~/.claude/scheduled-tasks/airbnb-contexto-compartido.md`, como indica tu `AGENTS.md` global.

## 2. Abrir el proyecto en Codex (app de ChatGPT → Codex)

1. Abre la carpeta `/Users/diegovalencia/Claude/Claude Code Dropbox/AIRBNB` como proyecto.
2. Cuando lo pregunte, márcalo como **confiable**. Queda en `~/.codex/config.toml` como
   `[projects."…/AIRBNB"] trust_level = "trusted"`.
3. El archivo `.env.local` ya está en esa carpeta. Codex lo usa para `npm run dev`. No lo subas
   a GitHub ni lo pegues en el chat.
4. Primera prueba: pídele «corre las pruebas, tipos, lint y build y dime el resultado». Debe
   responder en español con todo en verde.

## 3. Conectar el MCP de AirAdmin a Codex (opcional)

Así Codex consulta reservas, mantenimiento, salidas y cobros de la app real con tu usuario de
AirAdmin (solo admins). En la Terminal:

```bash
codex mcp add airadmin --url https://diegoprueba.vercel.app/api/mcp
```

```bash
codex mcp login airadmin
```

Se abre la pantalla «Autorizar» de AirAdmin; entra con tu cuenta y aprueba. Para comprobarlo:

```bash
codex mcp list
```

- Si `codex` no aparece en la Terminal, viene dentro de la app de ChatGPT, en
  `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`.
- Algunas versiones viejas pedían `experimental_use_rmcp_client = true` en `config.toml` para
  el OAuth de servidores remotos.
- Hay un error conocido de Codex Desktop: el servidor aparece autorizado, pero sus herramientas
  no se ven en el chat. Si te pasa, reinicia la app.
- Las herramientas de escritura del MCP (crear reservas, marcar cobros…) piden confirmación.
  Igual vale la regla de `AGENTS.md`: nada en producción sin tu «sí».

## 4. Codex en la nube (opcional)

Si creas un entorno de Codex Cloud para el repo `dfvalenciar1265/Diego`:

- **Script de preparación**: `npm ci`
- **Variables**: `NEXT_PUBLIC_SUPABASE_URL=https://example.invalid` y
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy`, solo para que compile.
- **No** cargues allí `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET` ni `CRON_SECRET`. Las
  pruebas no los necesitan, y en la nube ese acceso a producción quedaría sin supervisión.
- Las pruebas SQL (`scripts/test-migrations.sh`) necesitan Postgres. En la nube puedes agregar
  al script `apt-get install -y postgresql` o correrlas solo en tu Mac.

## 5. Lo que no se traslada solo

- **Memorias de Claude**: son archivos en `~/.claude/projects/.../memory/`. Codex no las importa,
  pero las lee porque tu `AGENTS.md` global le dice dónde están.
- **Permisos y bloqueos**: Claude Code bloquea por su cuenta las acciones en producción. En
  Codex, revisa que el modo de aprobación pida confirmación antes de comandos de red y escrituras
  fuera del proyecto. No uses el modo «sin aprobaciones» en este repo.
- **Rutinas programadas** de reseñas y precios: siguen en Claude. Si las quieres en Codex, se
  pasan una por una a «Automations» de Codex.
- **GitHub**: Codex usa el mismo `gh` de tu Mac. Revisa con `gh auth status` que la cuenta
  activa sea `info-softop`.
