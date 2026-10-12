import { updateSession } from '@/lib/supabase/middleware'
import { safeNextPath } from '@/lib/safe-next'
import { type NextRequest, NextResponse } from 'next/server'

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // /.well-known holds the public OAuth metadata that ChatGPT and Claude read before signing in.
  // API routes authenticate on their own (bearer tokens / cron secret), so skip the session work.
  // /logout signs out on its own (it must not bounce through /login?next=/logout).
  const isPublic = pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname.startsWith('/.well-known')
    || pathname === '/logout'
  if (isPublic) return NextResponse.next()

  const { supabaseResponse, user } = await updateSession(request)
  const isAuthPage = pathname.startsWith('/login')
  const isProtected = !isAuthPage

  if (isProtected && !user) {
    const url = new URL('/login', request.url)
    // Come back here after signing in (e.g. the "Autorizar" screen of a ChatGPT connection)
    if (pathname !== '/') url.searchParams.set('next', pathname + search)
    return NextResponse.redirect(url)
  }

  if (isAuthPage && user) {
    const next = safeNextPath(request.nextUrl.searchParams.get('next')) ?? '/'
    return NextResponse.redirect(new URL(next, request.url))
  }

  return supabaseResponse
}

export const config = {
  // Static assets, the service worker and the manifest never need a session check
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|icons/|sw\\.js|workbox-.*|swe-worker-.*|manifest\\.(?:json|webmanifest)|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|js|map)$).*)'],
}
