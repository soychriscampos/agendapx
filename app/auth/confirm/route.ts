import { type NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

function invalidInviteResponse(request: NextRequest) {
  const destination = new URL('/auth/invite', request.url)
  destination.searchParams.set('error', 'invalid')
  return NextResponse.redirect(destination)
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type')

  if (!tokenHash || type !== 'invite') {
    return invalidInviteResponse(request)
  }

  // A valid invite always lands on the password setup page. Any next value is
  // intentionally ignored instead of becoming an open redirect.

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'invite' })

  if (error) return invalidInviteResponse(request)

  return NextResponse.redirect(new URL('/auth/invite', request.url))
}
