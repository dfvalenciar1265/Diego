/**
 * RFC 9728 — le dice a ChatGPT y a Claude que /api/mcp inicia sesión con el OAuth 2.1 de
 * Supabase Auth. Público (sin datos), con CORS para clientes en el navegador.
 */
import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from 'mcp-handler'
import { AUTH_SERVER_URL } from '@/lib/mcp/config'

const handler = protectedResourceHandler({ authServerUrls: [AUTH_SERVER_URL] })
const options = metadataCorsOptionsRequestHandler()

export { handler as GET, options as OPTIONS }
