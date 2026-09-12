alter table public.assistant_settings
add column if not exists confirmation_enabled boolean not null default false;

alter table public.assistant_settings
add column if not exists unconfirmed_action text;

alter table public.assistant_settings
add constraint assistant_settings_unconfirmed_action_check
check (
  unconfirmed_action is null
  or unconfirmed_action in ('CANCEL', 'MANUAL')
);

comment on column public.assistant_settings.confirmation_enabled is
'Whether HelloPx should run appointment confirmation calls for this doctor.';

comment on column public.assistant_settings.confirmation_response_window_minutes is
'Minutes to wait after the WhatsApp reminder before applying the configured unconfirmed action.';

comment on column public.assistant_settings.unconfirmed_action is
'Action to take when the confirmation response window expires: CANCEL or MANUAL.';