import { createHmac, timingSafeEqual } from 'node:crypto'

import { createAdminClient } from '@/lib/supabase/admin'
import { renderDepositRequestEmail } from '@/lib/email/deposit-request-template'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ACTION_PURPOSE = 'deposit-confirmation:'

export type DepositEmailPayload = {
  ok: true
  request: { id: string; status: string; created_at: string }
  doctor: { id: string; name: string; email: string }
  patient: { id: string; name: string }
  contact: { id: string; name: string; phone_e164: string }
  appointment_type: { id: string; name: string }
  deposit: {
    type: 'FIXED'
    amount: number
    rule_name: string | null
    payment_instructions: {
      bank_name: string | null
      account_holder: string | null
      clabe: string | null
      account_number: string | null
      instructions: string | null
      message_template: string | null
    } | null
  }
  intake_answers: Array<{ field_key: string; field_label: string; value: string | null }>
  action: { id: string }
}

export function isUuid(value: string) {
  return UUID_PATTERN.test(value)
}

function actionSecret() {
  const secret = process.env.DEPOSIT_ACTION_SECRET
  if (!secret || secret.length < 32) throw new Error('DEPOSIT_ACTION_SECRET debe tener al menos 32 caracteres.')
  return secret
}

export function signDepositAction(actionId: string) {
  if (!isUuid(actionId)) throw new Error('La acción de anticipo no es válida.')
  return createHmac('sha256', actionSecret()).update(`${ACTION_PURPOSE}${actionId}`).digest('hex')
}

export function verifyDepositActionSignature(actionId: string, signature: string) {
  if (!isUuid(actionId) || !/^[a-f0-9]{64}$/i.test(signature)) return false
  const expected = Buffer.from(signDepositAction(actionId), 'hex')
  const received = Buffer.from(signature, 'hex')
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export function getDepositConfirmationUrl(actionId: string) {
  const appUrl = process.env.APP_URL
  if (!appUrl) throw new Error('Falta configurar APP_URL.')
  const url = new URL('/deposit/confirm', appUrl)
  url.searchParams.set('action', actionId)
  url.searchParams.set('signature', signDepositAction(actionId))
  return url.toString()
}

export function buildDepositWhatsAppMessage(payload: DepositEmailPayload) {
  const payment = payload.deposit.payment_instructions
  const amount = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(payload.deposit.amount)
  const values: Record<string, string> = {
    patient: payload.patient.name,
    paciente: payload.patient.name,
    doctor: payload.doctor.name,
    doctor_name: payload.doctor.name,
    amount,
    monto: amount,
    bank: payment?.bank_name ?? '',
    banco: payment?.bank_name ?? '',
    account_holder: payment?.account_holder ?? '',
    titular: payment?.account_holder ?? '',
    clabe: payment?.clabe ?? '',
    account_number: payment?.account_number ?? '',
    cuenta: payment?.account_number ?? '',
    instructions: payment?.instructions ?? '',
    instrucciones: payment?.instructions ?? '',
  }
  const template = payment?.message_template?.trim()
  const renderTemplate = (source: string) => source.replace(/\{\{([a-z_]+)\}\}|\{([a-z_]+)\}/gi, (match, doubleKey: string | undefined, singleKey: string | undefined) => {
    const key = (doubleKey ?? singleKey ?? '').toLowerCase()
    return values[key] ?? match
  })
  if (template) return renderTemplate(template)

  const defaultMessage = [
    `Hola, te compartimos los datos para realizar el anticipo de la cita de ${payload.patient.name}.`,
    `Doctor: ${payload.doctor.name}`,
    `Anticipo: ${amount} MXN`,
    payment?.bank_name ? `Banco: ${payment.bank_name}` : null,
    payment?.account_holder ? `Titular: ${payment.account_holder}` : null,
    payment?.clabe ? `CLABE: ${payment.clabe}` : null,
    payment?.account_number ? `Cuenta: ${payment.account_number}` : null,
    payment?.instructions,
  ].filter(Boolean).join('\n')
  return defaultMessage
}

export function getDepositWhatsAppUrl(payload: DepositEmailPayload) {
  const phone = payload.contact.phone_e164.replace(/^\+/, '').replace(/\D/g, '')
  if (!phone) throw new Error('El contacto no tiene un teléfono válido para WhatsApp.')
  return `https://wa.me/${phone}?text=${encodeURIComponent(buildDepositWhatsAppMessage(payload))}`
}

function rpcObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La respuesta de la operación de anticipo no es válida.')
  return value as Record<string, unknown>
}

export async function getDepositEmailPayload(requestId: string): Promise<DepositEmailPayload | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('get_deposit_email_payload', { p_request_id: requestId })
  if (error) throw new Error('No se pudo cargar la información del anticipo.')
  const result = rpcObject(data)
  if (result.ok !== true) return null
  return result as unknown as DepositEmailPayload
}

export async function confirmDepositAction(actionId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('confirm_deposit_from_action', { p_action_id: actionId })
  if (error) throw new Error('No se pudo confirmar el anticipo.')
  return rpcObject(data)
}

export async function getDepositActionState(actionId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('get_deposit_confirmation_action_state', { p_action_id: actionId })
  if (error) throw new Error('No se pudo consultar el estado del anticipo.')
  return rpcObject(data)
}

export async function deliverDepositRequestEmail(requestId: string) {
  const admin = createAdminClient()
  try {
    const { data: preparedData, error: prepareError } = await admin.rpc('prepare_deposit_email_action', { p_request_id: requestId })
    if (prepareError) throw new Error('No se pudo preparar el email de anticipo.')
    const prepared = rpcObject(preparedData)
    if (prepared.ok !== true) throw new Error(`No se pudo preparar el email de anticipo (${String(prepared.code ?? 'ERROR')}).`)
    const delivery = rpcObject(prepared.delivery)
    if (delivery.status === 'SENT') return { sent: true, idempotent: true }

    const { data: payloadData, error: payloadError } = await admin.rpc('get_deposit_email_payload', { p_request_id: requestId })
    if (payloadError) throw new Error('No se pudo construir el email de anticipo.')
    const payloadResult = rpcObject(payloadData)
    if (payloadResult.ok !== true) throw new Error(`No se pudo construir el email de anticipo (${String(payloadResult.code ?? 'ERROR')}).`)
    const payload = payloadResult as unknown as DepositEmailPayload
    if (payload.request.id !== requestId || payload.request.status !== 'WAITING_DEPOSIT' || payload.deposit.type !== 'FIXED' || !Number.isFinite(payload.deposit.amount) || payload.deposit.amount <= 0) {
      throw new Error('El payload del email no corresponde a una solicitud pendiente válida.')
    }
    if (payload.action.id !== prepared.action_id || payload.doctor.email !== prepared.recipient_email) {
      throw new Error('La acción o destinatario del email no coincide con la preparación.')
    }

    const { data: sendingData, error: sendingError } = await admin.rpc('mark_deposit_email_sending', { p_request_id: requestId })
    if (sendingError) throw new Error('No se pudo registrar el intento de envío.')
    const sending = rpcObject(sendingData)
    if (sending.ok !== true) throw new Error(`No se pudo registrar el intento de envío (${String(sending.code ?? 'ERROR')}).`)
    if (sending.delivery_status === 'SENT') return { sent: true, idempotent: true }

    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.RESEND_FROM_EMAIL
    if (!apiKey || !from) throw new Error('Falta configurar RESEND_API_KEY o RESEND_FROM_EMAIL.')

    try {
      const email = renderDepositRequestEmail(payload)
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `deposit-request/${requestId}`,
        },
        body: JSON.stringify({ from, to: [payload.doctor.email], subject: email.subject, html: email.html }),
        cache: 'no-store',
      })
      const responseBody: unknown = await response.json().catch(() => null)
      const responseRecord = responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody) ? responseBody as Record<string, unknown> : {}
      if (!response.ok || typeof responseRecord.id !== 'string') {
        const message = typeof responseRecord.message === 'string' ? responseRecord.message : `Resend respondió HTTP ${response.status}.`
        throw new Error(message)
      }

      const { data: sentData, error: sentError } = await admin.rpc('mark_deposit_email_sent', {
        p_request_id: requestId,
        p_resend_email_id: responseRecord.id,
      })
      if (sentError || rpcObject(sentData).ok !== true) throw new Error('Resend aceptó el email, pero no se pudo guardar el resultado.')
      return { sent: true, idempotent: false }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido al enviar el email.'
      try {
        const { data: failedData, error: failedError } = await admin.rpc('mark_deposit_email_failed', { p_request_id: requestId, p_error: message })
        if (failedError) {
          console.error('[Deposit email] No se pudo registrar delivery_status FAILED.', { requestId, error: failedError })
        } else if (!failedData || typeof failedData !== 'object' || Array.isArray(failedData)) {
          console.error('[Deposit email] mark_deposit_email_failed no devolvió un resultado válido.', { requestId, data: failedData })
        } else {
          const failedResult = failedData as Record<string, unknown>
          if (failedResult.ok !== true || !['FAILED', 'SENT'].includes(String(failedResult.delivery_status))) {
            console.error('[Deposit email] mark_deposit_email_failed no confirmó un estado terminal esperado.', {
              requestId,
              code: failedResult.code,
              deliveryStatus: failedResult.delivery_status,
            })
          }
        }
      } catch (markError) {
        console.error('[Deposit email] No se pudo registrar el fallo de envío.', markError)
      }
      console.error('[Deposit email] Falló el envío de anticipo.', { requestId, message })
      return { sent: false }
    }
  } catch (error) {
    console.error('[Deposit email] No se pudo iniciar el envío de anticipo.', {
      requestId,
      message: error instanceof Error ? error.message : 'Error desconocido',
    })
    return { sent: false }
  }
}

export function formatDepositAmount(amount: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount)
}
