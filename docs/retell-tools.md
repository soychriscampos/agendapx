# Retell tools (Fase 7)

La integración expone un único endpoint server-to-server:

```text
POST /api/integrations/retell/tools
Authorization: Bearer $RETELL_TOOLS_SECRET
Content-Type: application/json
```

`phone_number` siempre significa el número técnico asignado al doctor y es opcional. Para `prepare_booking`, el teléfono de quien llama se envía como `caller_phone_number` y HelloPx lo normaliza a E.164.

## Contexto

```bash
curl -X POST "$APP_URL/api/integrations/retell/tools" \
  -H "Authorization: Bearer $RETELL_TOOLS_SECRET" \
  -H 'Content-Type: application/json' \
  --data '{
    "tool":"get_context",
    "agent_id":"agent_xxx",
    "phone_number":"+526691234567",
    "call_id":"call_xxx"
  }'
```

## Preparar solicitud

```bash
curl -X POST "$APP_URL/api/integrations/retell/tools" \
  -H "Authorization: Bearer $RETELL_TOOLS_SECRET" \
  -H 'Content-Type: application/json' \
  --data '{
    "tool":"prepare_booking",
    "agent_id":"agent_xxx",
    "phone_number":"+526691234567",
    "call_id":"call_xxx",
    "contact_name":"Ana López",
    "caller_phone_number":"669 123 4567",
    "patient_name":"María López",
    "relationship":"CHILD",
    "appointment_type_id":"00000000-0000-4000-8000-000000000000",
    "intake_answers":[
      {
        "intake_field_id":"00000000-0000-4000-8000-000000000001",
        "value":"Escuinapa"
      }
    ]
  }'
```

Para reutilizar un paciente existente, agregar `patient_id`; de lo contrario la RPC crea un paciente nuevo ligado al contacto.

## Disponibilidad

```bash
curl -X POST "$APP_URL/api/integrations/retell/tools" \
  -H "Authorization: Bearer $RETELL_TOOLS_SECRET" \
  -H 'Content-Type: application/json' \
  --data '{
    "tool":"get_availability",
    "agent_id":"agent_xxx",
    "request_id":"00000000-0000-4000-8000-000000000002",
    "date_from":"2026-09-15",
    "date_to":"2026-09-22"
  }'
```

## Confirmar cita

```bash
curl -X POST "$APP_URL/api/integrations/retell/tools" \
  -H "Authorization: Bearer $RETELL_TOOLS_SECRET" \
  -H 'Content-Type: application/json' \
  --data '{
    "tool":"book_appointment",
    "agent_id":"agent_xxx",
    "request_id":"00000000-0000-4000-8000-000000000002",
    "start_at":"2026-09-15T16:00:00.000Z"
  }'
```

Si el slot deja de estar disponible, la respuesta es HTTP `409` con `code: "SLOT_UNAVAILABLE"` y `retryable: true`.
