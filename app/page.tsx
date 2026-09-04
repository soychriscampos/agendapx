import { redirectAuthenticatedUser } from '@/lib/auth'

export default async function Home() {
  await redirectAuthenticatedUser()
  return null
}
