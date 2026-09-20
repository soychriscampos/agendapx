# Fase 9 — Email accionable de anticipo

La integración usa estas variables server-only:

- `DEPOSIT_ACTION_SECRET`: secreto aleatorio de al menos 32 caracteres para firmar enlaces de confirmación mediante HMAC-SHA-256.
- `RESEND_API_KEY`: API key privada de Resend.
- `RESEND_FROM_EMAIL`: remitente verificado en Resend, por ejemplo `HelloPx <agenda@tu-dominio.mx>` (configura el valor real del dominio antes de desplegar).
- `APP_URL`: URL pública canónica de HelloPx; ya se utiliza en invitaciones y también forma los enlaces de solicitud y confirmación.

No se deben prefijar los secretos con `NEXT_PUBLIC_`. El backend llama las RPC de Fase 9 mediante el cliente Supabase service-role. La confirmación pública valida la firma antes de consultar la acción y requiere un POST explícito. La entrega usa la clave estable de Resend `deposit-request/{requestId}`.

Los marcadores disponibles en `message_template` para el mensaje manual de WhatsApp son `{patient}`, `{doctor}`, `{amount}`, `{bank}`, `{account_holder}`, `{clabe}`, `{account_number}` e `{instructions}`; también se aceptan sus equivalentes en español `{paciente}`, `{monto}`, `{banco}`, `{titular}`, `{cuenta}` e `{instrucciones}`.

## Deuda técnica fuera de Fase 9

Si una relación `patient_contacts` ya existe, `prepare_booking_from_call` reutiliza la relación persistida y no actualiza `relationship`, aunque una llamada posterior entregue un valor distinto. Debe revisarse fuera de Fase 9 para decidir si la relación debe actualizarse o si la relación debe almacenarse como snapshot por solicitud.
