/**
 * /api/mcp — servidor MCP de AirAdmin para los complementos de ChatGPT y para Claude.
 * Solo con un token del OAuth 2.1 de Supabase de un admin activo (lib/mcp/auth.ts); sin token
 * responde 401 con el WWW-Authenticate que lleva al documento RFC 9728.
 */
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { verifyMcpToken } from '@/lib/mcp/auth'
import { RESOURCE_METADATA_PATH } from '@/lib/mcp/config'
import { MCP_INSTRUCTIONS } from '@/lib/mcp/instructions'
import { registerTools } from '@/lib/mcp/tools'

const handler = createMcpHandler(registerTools, {
  serverInfo: { name: 'airadmin', version: '1.0.0' },
  instructions: MCP_INSTRUCTIONS,
})

const authHandler = withMcpAuth(handler, verifyMcpToken, {
  required: true,
  resourceMetadataPath: RESOURCE_METADATA_PATH,
})

export { authHandler as GET, authHandler as POST, authHandler as DELETE }
