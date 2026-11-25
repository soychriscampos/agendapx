-- HelloPx — Encuesta comercial V2
-- Migración aditiva. Preserva respuestas históricas V1.
-- Revisar contrato: survey_version usa los literales 'v1' / 'v2' (texto).
-- Ejecutar desde el flujo habitual de migraciones Supabase CLI.

BEGIN;

ALTER TABLE public.commercial_survey_responses
  ADD COLUMN IF NOT EXISTS survey_version text,
  ADD COLUMN IF NOT EXISTS missed_calls_volume text,
  ADD COLUMN IF NOT EXISTS assistant_concerns text[];

-- Todos los registros creados antes de desplegar V2 corresponden a V1.
UPDATE public.commercial_survey_responses
SET survey_version = 'v1'
WHERE survey_version IS NULL;

ALTER TABLE public.commercial_survey_responses
  ALTER COLUMN survey_version SET DEFAULT 'v2',
  ALTER COLUMN survey_version SET NOT NULL;

ALTER TABLE public.commercial_survey_responses
  ADD CONSTRAINT survey_version_allowed
  CHECK (survey_version IN ('v1', 'v2'));

-- Se conserva el requisito de respuestas completas V1.
-- V2 admite salto condicional de preguntas 5-7 si missed_calls = 'Nunca'.
-- La pregunta de utilidad corresponde solo a V1.
ALTER TABLE public.commercial_survey_responses
  DROP CONSTRAINT IF EXISTS completed_answers;

ALTER TABLE public.commercial_survey_responses
  ADD CONSTRAINT completed_answers
  CHECK (
    status = 'started'
    OR (
      completed_at IS NOT NULL
      AND specialty IS NOT NULL
      AND call_handler IS NOT NULL
      AND appointment_channels IS NOT NULL
      AND missed_calls IS NOT NULL
      AND (
        (survey_version = 'v1'
          AND obstacle IS NOT NULL
          AND missed_call_followup IS NOT NULL
          AND assistant_usefulness IS NOT NULL)
        OR
        (survey_version = 'v2'
          AND assistant_concerns IS NOT NULL
          AND (
            missed_calls = 'Nunca'
            OR (
              obstacle IS NOT NULL
              AND missed_call_followup IS NOT NULL
              AND missed_calls_volume IS NOT NULL
            )
          )
        )
      )
    )
  );

-- Interés 'Sí' / 'Tal vez' puede guardarse sin datos (contacto opcional).
-- Si se proporciona cualquier dato de contacto, exigir nombre, método,
-- valor y consentimiento expreso. Un contacto sin interés también exige consentimiento.
ALTER TABLE public.commercial_survey_responses
  DROP CONSTRAINT IF EXISTS consent_required;

ALTER TABLE public.commercial_survey_responses
  ADD CONSTRAINT consent_required
  CHECK (
    (
      contact_name IS NULL
      AND contact_method IS NULL
      AND contact_value IS NULL
      AND contact_consent_at IS NULL
    )
    OR (
      contact_name IS NOT NULL
      AND btrim(contact_name) <> ''
      AND contact_method IS NOT NULL
      AND contact_value IS NOT NULL
      AND btrim(contact_value) <> ''
      AND contact_consent_at IS NOT NULL
    )
  );

COMMENT ON COLUMN public.commercial_survey_responses.survey_version
  IS 'Encuesta comercial: v1 (histórico) o v2 (flujo actualizado).';
COMMENT ON COLUMN public.commercial_survey_responses.missed_calls_volume
  IS 'V2: estimación de llamadas semanales perdidas. NULL en V1 o al omitir por Nunca.';
COMMENT ON COLUMN public.commercial_survey_responses.assistant_concerns
  IS 'V2: respuestas múltiples sobre preocupaciones. NULL en V1.';

COMMIT;

-- Verificación sugerida (solo lectura, ejecutar tras aplicar):
-- SELECT survey_version, status, COUNT(*) FROM public.commercial_survey_responses GROUP BY 1,2 ORDER BY 1,2;
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = 'public.commercial_survey_responses'::regclass
-- AND conname IN ('completed_answers','consent_required','survey_version_allowed');
