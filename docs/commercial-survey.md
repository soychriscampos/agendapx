# Encuesta comercial

La encuesta pública está en `/encuesta`. El dashboard restringido a MASTER está en `/master/encuesta`.

## Configuración

La migración `supabase/migrations/20261117231744_commercial_survey.sql` crea la tabla y sus índices. El acceso anónimo y autenticado a la tabla está revocado; el endpoint del servidor usa `SUPABASE_SERVICE_ROLE_KEY`.

Cuando exista una llamada de demostración funcional, configura `HELLOPX_SURVEY_DEMO_PHONE` en el entorno del servidor con un número E.164 (por ejemplo, `+` seguido del código de país y número). Mientras no exista, la página explica que la llamada estará disponible más adelante. No se ha conectado Retell ni configurado un agente, prompt o webhook.

## Prueba manual

1. Abre `/encuesta` en un navegador sin iniciar sesión.
2. Responde las siete preguntas. Comprueba que no puedes avanzar sin elegir respuesta ni dejar vacía la especificación de «Otra» u «Otro».
3. Al terminar, comprueba que el registro aparece como completado en `/master/encuesta` usando una cuenta MASTER.
4. Elige «Finalizar encuesta» y comprueba que aparece el agradecimiento.
5. En otro navegador o sesión, repite la encuesta y acepta conocer HelloPx. Si el número está configurado, pulsa «Llamar» y comprueba que el dashboard registra el clic. Esto no confirma que la llamada se haya realizado.
6. Elige interés comercial, introduce datos y acepta el seguimiento. Comprueba el contacto y el detalle en el dashboard, y prueba los filtros.

El dashboard muestra las 2,000 respuestas más recientes que coinciden con los filtros. Los filtros de fecha se aplican sobre la fecha de inicio.
