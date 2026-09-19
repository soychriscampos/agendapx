import type { DepositEmailPayload } from '@/lib/deposits/phase9'
import { formatDepositAmount, getDepositConfirmationUrl, getDepositWhatsAppUrl } from '@/lib/deposits/phase9'

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

function detailRow(label: string, value: string) {
  return `<tr><td style="padding:12px 0;color:#737373;font-size:14px;line-height:20px;vertical-align:top">${escapeHtml(label)}</td><td style="padding:12px 0;color:#262626;font-size:14px;line-height:20px;text-align:right;vertical-align:top">${escapeHtml(value)}</td></tr>`
}

export function renderDepositRequestEmail(payload: DepositEmailPayload) {
  const amount = formatDepositAmount(payload.deposit.amount)
  const confirmUrl = escapeHtml(getDepositConfirmationUrl(payload.action.id))
  const whatsappUrl = escapeHtml(getDepositWhatsAppUrl(payload))
  const appUrl = process.env.APP_URL
  if (!appUrl) throw new Error('Falta configurar APP_URL.')
  const requestUrl = escapeHtml(new URL(`/app/requests/${payload.request.id}`, appUrl).toString())
  const payment = payload.deposit.payment_instructions
  const intakeRows = payload.intake_answers
    .filter((answer) => answer.value?.trim())
    .map((answer) => detailRow(answer.field_label, answer.value ?? ''))
    .join('')
  const paymentRows = [
    ['Banco', payment?.bank_name],
    ['Titular', payment?.account_holder],
    ['CLABE', payment?.clabe],
    ['Cuenta', payment?.account_number],
    ['Instrucciones', payment?.instructions],
  ].filter((row): row is [string, string] => Boolean(row[1]?.trim()))
    .map(([label, value]) => detailRow(label, value))
    .join('')

  return {
    subject: `${payload.patient.name} quiere agendar una cita`,
    html: `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#171717">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;background-color:#f5f5f5">
      <tr>
        <td align="center" style="padding:44px 12px 48px">
          <table role="presentation" width="52" cellspacing="0" cellpadding="0" style="width:52px;border-collapse:separate;margin:0 auto 24px">
            <tr><td width="52" height="52" align="center" valign="middle" style="width:52px;height:52px;border:1px solid #e5e5e5;border-radius:14px;background-color:#ffffff;color:#171717;font-size:22px;line-height:52px;font-weight:bold">H</td></tr>
          </table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;border:1px solid #e5e5e5;border-radius:16px;border-collapse:separate;background-color:#ffffff">
            <tr>
              <td style="padding:48px 44px 40px">
                <p style="margin:0;color:#737373;font-size:14px;line-height:20px;font-weight:bold;letter-spacing:.04em">HelloPx</p>
                <h1 style="margin:22px 0 0;color:#171717;font-size:28px;line-height:36px;font-weight:700">${escapeHtml(payload.patient.name)} quiere agendar una cita</h1>
                <p style="margin:14px 0 0;color:#525252;font-size:16px;line-height:25px">Esta solicitud requiere un anticipo de <strong style="color:#171717">${escapeHtml(amount)} MXN</strong> antes de continuar con la agenda.</p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin-top:28px;border-collapse:collapse;border-top:1px solid #e5e5e5;border-bottom:1px solid #e5e5e5">
                  ${detailRow('Paciente', payload.patient.name)}
                  ${detailRow('Contacto', `${payload.contact.name} · ${payload.contact.phone_e164}`)}
                  ${detailRow('Tipo de cita', payload.appointment_type.name)}
                  ${detailRow('Anticipo', `${amount} MXN`)}
                  ${intakeRows ? `<tr><td colspan="2" style="padding:16px 0 2px;border-top:1px solid #e5e5e5;color:#525252;font-size:13px;line-height:18px;font-weight:bold">Datos compartidos</td></tr>${intakeRows}` : ''}
                </table>

                ${paymentRows ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin-top:18px;border-collapse:collapse">${paymentRows}</table>` : ''}

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin-top:28px;border-collapse:collapse;border-top:1px solid #e5e5e5">
                  <tr><td style="padding:24px 0 12px;color:#262626;font-size:15px;line-height:22px;font-weight:bold">1. Envíale tus datos para realizar el pago</td></tr>
                  <tr><td style="padding:0 0 24px">
                    <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:separate"><tr><td align="center" bgcolor="#25D366" style="border-radius:8px;background-color:#25D366"><a href="${whatsappUrl}" style="display:inline-block;padding:13px 20px;border-radius:8px;color:#ffffff;font-size:14px;line-height:20px;font-weight:bold;text-decoration:none">Enviar por WhatsApp</a></td></tr></table>
                  </td></tr>
                  <tr><td style="padding:22px 0 12px;border-top:1px solid #e5e5e5;color:#262626;font-size:15px;line-height:22px;font-weight:bold">2. Cuando recibas el pago, confirma el anticipo</td></tr>
                  <tr><td style="padding:0 0 22px">
                    <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:separate"><tr><td align="center" bgcolor="#171717" style="border-radius:8px;background-color:#171717"><a href="${confirmUrl}" style="display:inline-block;padding:13px 20px;border-radius:8px;color:#ffffff;font-size:14px;line-height:20px;font-weight:bold;text-decoration:none">Confirmar anticipo</a></td></tr></table>
                  </td></tr>
                </table>

                <p style="margin:20px 0 0;color:#737373;font-size:14px;line-height:22px"><a href="${requestUrl}" style="color:#404040;text-decoration:underline">Entrar a HelloPx</a></p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin-top:32px;border-collapse:collapse;border-top:1px solid #e5e5e5"><tr><td style="padding-top:20px;color:#a3a3a3;font-size:12px;line-height:18px">Este correo fue enviado automáticamente por HelloPx.</td></tr></table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  }
}
