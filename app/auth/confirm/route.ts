import { type NextRequest, NextResponse } from 'next/server'

function invalidInviteResponse(request: NextRequest) {
  const destination = new URL('/auth/invite', request.url)
  destination.searchParams.set('error', 'invalid')
  return NextResponse.redirect(destination)
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type')

  if (!tokenHash || (type !== 'invite' && type !== 'recovery')) {
    return invalidInviteResponse(request)
  }

  // Do not verify on GET. Mail security scanners and link previews can visit
  // this URL before the recipient does. Verification happens only after the
  // recipient explicitly accepts the invitation on /auth/accept.
  const destination = new URL('/auth/accept', request.url)
  destination.searchParams.set('token_hash', tokenHash)
  destination.searchParams.set('type', type)
  return NextResponse.redirect(destination)
}
