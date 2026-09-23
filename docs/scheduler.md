# Scheduler interno de confirmaciones

La ruta `POST /api/internal/scheduler/confirmations` ejecuta el lote de
confirmaciones vencidas y procesa ventanas de respuesta expiradas.

Debe invocarse con un secreto dedicado:

```text
SCHEDULER_SECRET=<valor aleatorio de al menos 32 caracteres>
```

La petición debe incluir:

```http
Authorization: Bearer <SCHEDULER_SECRET>
```

El cron de Supabase todavía no forma parte de esta implementación. La ruta
usa los RPCs existentes como selectores y transiciones atómicas, y delega el
dispatch de llamadas en el runtime de Fase 11.
