import { updateSession } from '@/lib/supabase/middleware'
import { safeNextPath } from '@/lib/safe-next'
import { type NextRequest, NextResponse } from 'next/server'

export async function proxy(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)
  const { pathname, search } = request.nextUrl

  const isAuthPage = pathname.startsWith('/login')
  // /.well-known holds the public OAuth metadata that ChatGPT and Claude read before signing in
  const isPublic = pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname.startsWith('/.well-known')
  const isProtected = !isAuthPage && !isPublic

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
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|icons/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$).*)'],
}
