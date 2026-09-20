import Retell from 'retell-sdk'

let client: Retell | null = null

export function getRetellClient() {
  if (client) return client

  const apiKey = process.env.RETELL_API_KEY
  if (!apiKey) throw new Error('Retell no está configurado.')

  // A createPhoneCall timeout can be ambiguous. Do not let the SDK repeat
  // a non-idempotent outbound call behind the application's back.
  client = new Retell({ apiKey, maxRetries: 0 })
  return client
}
