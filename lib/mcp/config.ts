/** Documento RFC 9728 del MCP (path insertion de /api/mcp). */
export const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/api/mcp'

/** Servidor de autorización: el OAuth 2.1 de Supabase Auth del proyecto (su issuer). */
export const AUTH_SERVER_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`
