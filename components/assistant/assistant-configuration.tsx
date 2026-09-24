"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { updateDoctorProfile } from "@/app/actions";
import { DoctorScheduleForm } from "@/components/schedule/doctor-schedule-form";
import {
  saveAppointmentType,
  deleteAppointmentType,
  saveAssistantSettings,
  saveDepositRule,
  deleteDepositRule,
  reorderDepositRules,
  saveIntakeField,
  deleteIntakeField,
  saveKnowledgeItem,
  deleteKnowledgeItem,
  savePaymentInstructions,
  type AssistantActionState,
} from "@/lib/assistant/assistant-configuration";
import {
  sortDepositRules,
  type DepositRule,
} from "@/lib/assistant/deposit-rules";
import type {
  DoctorSchedule,
  RecurringUnavailability,
} from "@/lib/schedule/doctor-schedule";

type AppointmentType = {
  id: string;
  name: string;
  duration_minutes: number;
  price: number | null;
  is_active: boolean;
};
type IntakeField = {
  id: string;
  field_key: string;
  label: string;
  is_required: boolean;
  is_active: boolean;
  sort_order: number;
};
type KnowledgeItem = {
  id: string;
  title: string;
  content: string;
  is_active: boolean;
  sort_order: number;
};
type Settings = {
  assistant_name: string | null;
  confirmation_enabled: boolean | null;
  confirmation_lead_minutes: number | null;
  confirmation_response_window_minutes: number | null;
  unconfirmed_action: "CANCEL" | "MANUAL" | null;
  manual_follow_up_on_no_answer: boolean;
};
type Payment = {
  bank_name: string | null;
  account_holder: string | null;
  clabe: string | null;
  account_number: string | null;
  instructions: string | null;
  message_template: string | null;
};
const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200";
const primary =
  "rounded-lg bg-zinc-900 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
const secondary =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
const textAction = "text-sm font-medium text-zinc-700 transition hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40";
const destructiveAction = "text-sm font-medium text-red-700 transition hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-40";
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-zinc-700">
      {label}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}
function Toggle({
  name,
  checked,
  label,
}: {
  name: string;
  checked?: boolean;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
      <input
        type="checkbox"
        name={name}
        defaultChecked={checked}
        className="h-4 w-4 accent-zinc-900"
      />
      {label}
    </label>
  );
}
function Form({
  action,
  doctorId,
  children,
  label = "Guardar cambios",
  done,
}: {
  action: (d: FormData) => Promise<AssistantActionState>;
  doctorId: string;
  children: ReactNode;
  label?: string;
  done?: (result: AssistantActionState) => void;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<AssistantActionState>({});
  const r = useRouter();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    start(async () => {
      const x = await action(new FormData(e.currentTarget));
      setState(x);
      if (x.success) {
        done?.(x);
        r.refresh();
      }
    });
  }
  return (
    <form onSubmit={submit}>
      <input type="hidden" name="doctor_id" value={doctorId} />
      {children}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button disabled={pending} className={primary}>
          {pending ? "Guardando…" : label}
        </button>
        {state.success ? (
          <span
            className="assistant-save-feedback text-sm font-medium text-emerald-700"
            role="status"
          >
            Cambios guardados
          </span>
        ) : null}
        {state.error ? (
          <span className="text-sm text-red-700" role="alert">
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
function Section({
  title,
  summary,
  open,
  toggle,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  toggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left hover:bg-zinc-50"
      >
        <span>
          <b className="block text-lg text-zinc-950">{title}</b>
          <span className="mt-1 block text-sm text-zinc-600">{summary}</span>
        </span>
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-lg transition-transform duration-200 ${open ? "rotate-45 bg-zinc-100" : ""}`}
        >
          +
        </span>
      </button>
      {open ? (
        <div className="assistant-section-enter border-t border-zinc-100 px-5 py-6">
          {children}
        </div>
      ) : null}
    </section>
  );
}
function Delete({
  action,
  doctorId,
  id,
  done,
}: {
  action: (d: FormData) => Promise<AssistantActionState>;
  doctorId: string;
  id: string;
  done: (result: AssistantActionState) => void;
}) {
  const [p, start] = useTransition();
  const r = useRouter();
  const [state, setState] = useState<AssistantActionState>({});
  return (
    <span className="inline-flex items-center gap-2">
    <button
      type="button"
      disabled={p}
      onClick={() => {
        if (!confirm("¿Eliminar este elemento?")) return;
        const d = new FormData();
        d.set("doctor_id", doctorId);
        d.set("id", id);
        start(async () => {
          const result = await action(d);
          setState(result);
          if (result.success) {
            done(result);
            r.refresh();
          }
        });
      }}
      className={destructiveAction}
    >
      {p ? "Eliminando…" : "Eliminar"}
    </button>
    {state.error ? <span className="text-sm text-red-700" role="alert">{state.error}</span> : null}
    </span>
  );
}
function Types({
  doctorId,
  items,
}: {
  doctorId: string;
  items: AppointmentType[];
}) {
  const [edit, setEdit] = useState<string | "new" | null>(null);
  const [feedback, setFeedback] = useState<AssistantActionState>({});
  return (
    <div className="space-y-3">
      {items.map((x) =>
        edit === x.id ? (
          <TypeEditor
            key={x.id}
            item={x}
            doctorId={doctorId}
            close={() => setEdit(null)}
            complete={() => setFeedback({ success: "Cambios guardados" })}
          />
        ) : (
          <Row
            key={x.id}
            title={x.name}
            detail={`${x.duration_minutes} min${x.price !== null ? ` · $${x.price}` : ""} · ${x.is_active ? "Activa" : "Inactiva"}`}
            edit={() => setEdit(x.id)}
            remove={
              <Delete
                action={deleteAppointmentType}
                doctorId={doctorId}
                id={x.id}
                done={() => setFeedback({ success: "Cambios guardados" })}
              />
            }
          />
        ),
      )}
      {edit === "new" ? (
        <TypeEditor
          doctorId={doctorId}
          close={() => setEdit(null)}
          complete={() => setFeedback({ success: "Cambios guardados" })}
        />
      ) : (
        <button
          onClick={() => setEdit("new")}
          className="text-sm font-medium text-zinc-700"
        >
          + Agregar tipo de cita
        </button>
      )}
      <CollectionFeedback feedback={feedback} />
    </div>
  );
}
function TypeEditor({
  doctorId,
  item,
  close,
  complete,
}: {
  doctorId: string;
  item?: AppointmentType;
  close: () => void;
  complete: () => void;
}) {
  return (
    <Editor>
      <Form
        action={saveAppointmentType}
        doctorId={doctorId}
        done={() => {
          close();
          complete();
        }}
        label={item ? "Guardar tipo de cita" : "Agregar tipo de cita"}
      >
        <input type="hidden" name="id" value={item?.id ?? ""} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Nombre">
            <input
              name="name"
              className={input}
              defaultValue={item?.name}
              required
            />
          </Field>
          <Field label="Duración">
            <input
              name="duration_minutes"
              type="number"
              className={input}
              defaultValue={item?.duration_minutes}
              required
            />
          </Field>
          <Field label="Precio">
            <input
              name="price"
              type="number"
              className={input}
              defaultValue={item?.price ?? ""}
            />
          </Field>
        </div>
        <div className="mt-4">
          <Toggle
            name="is_active"
            checked={item?.is_active ?? true}
            label="Disponible para el asistente"
          />
        </div>
      </Form>
      <Cancel close={close} />
    </Editor>
  );
}
function Questions({
  doctorId,
  items,
}: {
  doctorId: string;
  items: IntakeField[];
}) {
  const [edit, setEdit] = useState<string | "new" | null>(null);
  const [feedback, setFeedback] = useState<AssistantActionState>({});
  return (
    <div className="space-y-3">
      {items.map((x, i) =>
        edit === x.id ? (
          <QuestionEditor
            key={x.id}
            item={x}
            doctorId={doctorId}
            close={() => setEdit(null)}
            complete={() => setFeedback({ success: "Cambios guardados" })}
          />
        ) : (
          <Row
            key={x.id}
            title={x.label}
            detail={`${x.is_required ? "Obligatoria" : "Opcional"} · ${x.is_active ? "Activa" : "Inactiva"}`}
            suffix={`Pregunta ${i + 1}`}
            edit={() => setEdit(x.id)}
            remove={<Delete action={deleteIntakeField} doctorId={doctorId} id={x.id} done={() => setFeedback({ success: "Cambios guardados" })} />}
          />
        ),
      )}
      {edit === "new" ? (
        <QuestionEditor
          doctorId={doctorId}
          close={() => setEdit(null)}
          order={items.length}
          complete={() => setFeedback({ success: "Cambios guardados" })}
        />
      ) : (
        <button
          onClick={() => setEdit("new")}
          className="text-sm font-medium text-zinc-700"
        >
          + Agregar pregunta
        </button>
      )}
      <CollectionFeedback feedback={feedback} />
    </div>
  );
}
function QuestionEditor({
  doctorId,
  item,
  close,
  order = 0,
  complete,
}: {
  doctorId: string;
  item?: IntakeField;
  close: () => void;
  order?: number;
  complete: () => void;
}) {
  return (
    <Editor>
      <Form action={saveIntakeField} doctorId={doctorId} done={() => { close(); complete(); }}>
        <input type="hidden" name="id" value={item?.id ?? ""} />
        <input
          type="hidden"
          name="field_key"
          value={item?.field_key ?? "custom_question"}
        />
        <input
          type="hidden"
          name="sort_order"
          value={item?.sort_order ?? order}
        />
        <Field label="Pregunta para el paciente">
          <input
            name="label"
            className={input}
            defaultValue={item?.label}
            required
          />
        </Field>
        <div className="mt-4 flex gap-5">
          <Toggle
            name="is_required"
            checked={item?.is_required ?? true}
            label="Obligatoria"
          />
          <Toggle
            name="is_active"
            checked={item?.is_active ?? true}
            label="Activa"
          />
        </div>
      </Form>
      <Cancel close={close} />
    </Editor>
  );
}
function Knowledge({
  doctorId,
  items,
}: {
  doctorId: string;
  items: KnowledgeItem[];
}) {
  const [edit, setEdit] = useState<string | "new" | null>(null);
  const [feedback, setFeedback] = useState<AssistantActionState>({});
  return (
    <div className="space-y-3">
      {items.map((x) =>
        edit === x.id ? (
          <KnowledgeEditor
            key={x.id}
            item={x}
            doctorId={doctorId}
            close={() => setEdit(null)}
            complete={() => setFeedback({ success: "Cambios guardados" })}
          />
        ) : (
          <Row
            key={x.id}
            title={x.title}
            detail={x.content}
            edit={() => setEdit(x.id)}
            remove={<Delete action={deleteKnowledgeItem} doctorId={doctorId} id={x.id} done={() => setFeedback({ success: "Cambios guardados" })} />}
          />
        ),
      )}
      {edit === "new" ? (
        <KnowledgeEditor
          doctorId={doctorId}
          close={() => setEdit(null)}
          order={items.length}
          complete={() => setFeedback({ success: "Cambios guardados" })}
        />
      ) : (
        <button
          onClick={() => setEdit("new")}
          className="text-sm font-medium text-zinc-700"
        >
          + Agregar información
        </button>
      )}
      <CollectionFeedback feedback={feedback} />
    </div>
  );
}
function KnowledgeEditor({
  doctorId,
  item,
  close,
  order = 0,
  complete,
}: {
  doctorId: string;
  item?: KnowledgeItem;
  close: () => void;
  order?: number;
  complete: () => void;
}) {
  return (
    <Editor>
      <Form action={saveKnowledgeItem} doctorId={doctorId} done={() => { close(); complete(); }}>
        <input type="hidden" name="id" value={item?.id ?? ""} />
        <input
          type="hidden"
          name="sort_order"
          value={item?.sort_order ?? order}
        />
        <Field label="Tema">
          <input
            name="title"
            className={input}
            defaultValue={item?.title}
            required
          />
        </Field>
        <Field label="Información que puede compartir">
          <textarea
            name="content"
            className={input}
            rows={4}
            defaultValue={item?.content}
            required
          />
        </Field>
        <div className="mt-4">
          <Toggle
            name="is_active"
            checked={item?.is_active ?? true}
            label="Disponible para el asistente"
          />
        </div>
      </Form>
      <Cancel close={close} />
    </Editor>
  );
}
function Row({
  title,
  detail,
  edit,
  suffix,
  remove,
}: {
  title: string;
  detail: string;
  edit: () => void;
  suffix?: string;
  remove?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-zinc-50 px-4 py-3">
      <div>
        <p className="font-medium text-zinc-950">{title}</p>
        <p className="mt-1 max-w-xl text-sm text-zinc-600">{detail}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
        {suffix ? (
          <span className="text-xs text-zinc-400">{suffix}</span>
        ) : null}
        <button onClick={edit} className={secondary}>
          Editar
        </button>
        {remove ? <span className="border-l border-zinc-200 pl-3">{remove}</span> : null}
      </div>
    </div>
  );
}
function CollectionFeedback({ feedback }: { feedback: AssistantActionState }) {
  if (feedback.error) {
    return <p className="text-sm text-red-700" role="alert">{feedback.error}</p>;
  }
  if (feedback.success) {
    return <p className="assistant-save-feedback text-sm font-medium text-emerald-700" role="status">Cambios guardados</p>;
  }
  return null;
}
function Cancel({ close }: { close: () => void }) {
  return (
    <button type="button" onClick={close} className={textAction}>
      Cancelar
    </button>
  );
}
function Editor({ children }: { children: ReactNode }) {
  return (
    <div className="assistant-section-enter rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      {children}
    </div>
  );
}

function depositRuleScopeDetail(
  item: DepositRule,
  appointmentTypes: AppointmentType[],
  intakeFields: IntakeField[],
) {
  if (item.scope === "APPOINTMENT_TYPE") {
    return `Tipo de cita: ${appointmentTypes.find((type) => type.id === item.appointment_type_id)?.name ?? "Sin definir"}`;
  }

  if (item.scope === "INTAKE_FIELD") {
    const label = intakeFields.find((field) => field.id === item.intake_field_id)?.label ?? "Dato del paciente";
    return `${label}: ${item.condition_value ?? "Sin definir"}`;
  }

  return "Todas las citas";
}

function DepositRuleEditor({
  doctorId,
  item,
  appointmentTypes,
  intakeFields,
  close,
  saved,
}: {
  doctorId: string;
  item?: DepositRule;
  appointmentTypes: AppointmentType[];
  intakeFields: IntakeField[];
  close: () => void;
  saved: () => void;
}) {
  const [scope, setScope] = useState<DepositRule["scope"]>(item?.scope ?? "ALL");

  return (
    <Editor>
      <Form
        action={saveDepositRule}
        doctorId={doctorId}
        label={item ? "Guardar regla" : "Agregar regla"}
        done={() => {
          close();
          saved();
        }}
      >
        <input type="hidden" name="id" value={item?.id ?? ""} />
        {item ? (
          <input type="hidden" name="sort_order" value={item.sort_order} />
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre de referencia">
            <input
              name="name"
              className={input}
              defaultValue={item?.name ?? ""}
              placeholder="Ej. Pacientes de Escuinapa"
              required
            />
          </Field>
          <Field label="Aplica a">
            <select
              name="scope"
              className={input}
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as DepositRule["scope"])
              }
            >
              <option value="ALL">Todas las citas</option>
              <option value="APPOINTMENT_TYPE">Un tipo de cita</option>
              <option value="INTAKE_FIELD">Una respuesta del paciente</option>
            </select>
          </Field>
          {scope === "APPOINTMENT_TYPE" ? (
            <Field label="Tipo de cita">
              <select
                name="appointment_type_id"
                className={input}
                defaultValue={item?.appointment_type_id ?? ""}
                required
              >
                <option value="">Selecciona un tipo</option>
                {appointmentTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {scope === "INTAKE_FIELD" ? (
            <div className="assistant-conditional-enter contents">
              <Field label="Pregunta">
                <select
                  name="intake_field_id"
                  className={input}
                  defaultValue={item?.intake_field_id ?? ""}
                  required
                >
                  <option value="">Selecciona una pregunta</option>
                  {intakeFields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.label}
                    </option>
                  ))}
                </select>
              </Field>
              <input type="hidden" name="operator" value="EQUALS" />
              <Field label="Respuesta">
                <input
                  name="condition_value"
                  className={input}
                  defaultValue={item?.condition_value ?? ""}
                  required
                />
              </Field>
            </div>
          ) : null}
          <Field label="Cantidad de anticipo">
            <input
              name="deposit_value"
              type="number"
              min="0.01"
              step="0.01"
              className={input}
              defaultValue={
                item?.deposit_type === "PERCENTAGE" ? "" : (item?.deposit_value ?? "")
              }
              placeholder="Ej. 400"
              required={item?.deposit_type !== "PERCENTAGE"}
            />
          </Field>
        </div>
        <div className="mt-4">
          <Toggle name="is_active" checked={item?.is_active ?? true} label="Activa" />
        </div>
        {item?.deposit_type === "PERCENTAGE" ? (
          <p className="mt-3 text-sm leading-6 text-amber-700">
            Esta regla usaba porcentaje. Ingresa una cantidad para actualizarla.
          </p>
        ) : null}
      </Form>
      <div className="mt-4"><Cancel close={close} /></div>
    </Editor>
  );
}

function DepositRules({
  doctorId,
  items,
  appointmentTypes,
  intakeFields,
}: {
  doctorId: string;
  items: DepositRule[];
  appointmentTypes: AppointmentType[];
  intakeFields: IntakeField[];
}) {
  const orderedItems = sortDepositRules(items);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [isCreatingRule, setIsCreatingRule] = useState(false);
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<AssistantActionState>({});
  const router = useRouter();

  function saved() {
    setFeedback({ success: "Cambios guardados" });
  }

  function moveRule(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (pending || target < 0 || target >= orderedItems.length) return;

    const ids = orderedItems.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const data = new FormData();
    data.set("doctor_id", doctorId);
    data.set("ids", JSON.stringify(ids));
    setFeedback({});

    start(async () => {
      const result = await reorderDepositRules(data);
      setFeedback(result);
      if (result.success) router.refresh();
    });
  }

  function deleteRule(id: string) {
    if (!confirm("¿Eliminar esta regla de anticipo?")) return;

    const data = new FormData();
    data.set("doctor_id", doctorId);
    data.set("id", id);
    setFeedback({});
    start(async () => {
      const result = await deleteDepositRule(data);
      setFeedback(result);
      if (result.success) {
        setEditingRuleId(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-5 space-y-3">
      {orderedItems.map((item, index) =>
        editingRuleId === item.id ? (
          <DepositRuleEditor
            key={item.id}
            doctorId={doctorId}
            item={item}
            appointmentTypes={appointmentTypes}
            intakeFields={intakeFields}
            close={() => setEditingRuleId(null)}
            saved={saved}
          />
        ) : (
          <div
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-zinc-50 px-4 py-3"
          >
            <div>
              <p className="font-medium text-zinc-950">{item.name}</p>
              <p className="mt-1 text-sm text-zinc-600">
                {depositRuleScopeDetail(item, appointmentTypes, intakeFields)} · Solicitar ${item.deposit_value} · {item.is_active ? "Activa" : "Inactiva"}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
              <button
                type="button"
                onClick={() => setEditingRuleId(item.id)}
                className={secondary}
              >
                Editar
              </button>
              <button
                type="button"
                disabled={pending || index === 0}
                onClick={() => moveRule(index, -1)}
                className={textAction}
              >
                Subir
              </button>
              <button
                type="button"
                disabled={pending || index === orderedItems.length - 1}
                onClick={() => moveRule(index, 1)}
                className={textAction}
              >
                Bajar
              </button>
              <span className="border-l border-zinc-200 pl-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => deleteRule(item.id)}
                  className={destructiveAction}
                >
                  {pending ? "Eliminando…" : "Eliminar"}
                </button>
              </span>
            </div>
          </div>
        ),
      )}
      {isCreatingRule ? (
        <DepositRuleEditor
          doctorId={doctorId}
          appointmentTypes={appointmentTypes}
          intakeFields={intakeFields}
          close={() => setIsCreatingRule(false)}
          saved={saved}
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsCreatingRule(true)}
          className={textAction}
        >
          + Agregar regla
        </button>
      )}
      <CollectionFeedback feedback={feedback} />
    </div>
  );
}

function OfficeProfile({
  doctorId,
  doctor,
}: {
  doctorId: string;
  doctor: {
    display_name: string;
    specialty: string | null;
    address: string | null;
    phone: string | null;
    whatsapp: string | null;
  };
}) {
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState<AssistantActionState>({});

  if (editing) {
    return (
      <Editor>
        <Form
          action={updateDoctorProfile}
          doctorId={doctorId}
          done={() => {
            setEditing(false);
            setFeedback({ success: "Cambios guardados" });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre">
              <input name="p_display_name" className={input} defaultValue={doctor.display_name} required />
            </Field>
            <Field label="Especialidad">
              <input name="p_specialty" className={input} defaultValue={doctor.specialty ?? ""} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Dirección">
                <textarea name="p_address" className={input} rows={3} defaultValue={doctor.address ?? ""} />
              </Field>
            </div>
          </div>
        </Form>
        <div className="mt-4"><Cancel close={() => setEditing(false)} /></div>
      </Editor>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-zinc-950">Tu consultorio</h3>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            Revisa los datos que HelloPx comparte al orientar a tus pacientes.
          </p>
        </div>
        <button type="button" className={secondary} onClick={() => setEditing(true)}>
          Editar
        </button>
      </div>
      <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {[
          ["Nombre", doctor.display_name],
          ["Especialidad", doctor.specialty ?? "—"],
          ["Dirección", doctor.address ?? "—"],
          ["Teléfono", doctor.phone ?? "—"],
          ["WhatsApp", doctor.whatsapp ?? "—"],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
            <dd className="mt-1 text-sm text-zinc-800">{value}</dd>
          </div>
        ))}
      </dl>
      <CollectionFeedback feedback={feedback} />
    </div>
  );
}

export function AssistantConfiguration({
  doctorId,
  doctor,
  schedule,
  recurringUnavailability,
  settings,
  payment,
  appointmentTypes,
  intakeFields,
  depositRules,
  knowledgeItems,
}: {
  doctorId: string;
  doctor: {
    display_name: string;
    specialty: string | null;
    address: string | null;
    phone: string | null;
    whatsapp: string | null;
  };
  timezone: string;
  schedule: DoctorSchedule;
  recurringUnavailability: RecurringUnavailability[];
  settings: Settings | null;
  payment: Payment | null;
  appointmentTypes: AppointmentType[];
  intakeFields: IntakeField[];
  depositRules: DepositRule[];
  knowledgeItems: KnowledgeItem[];
}) {
  const s = settings ?? {
    assistant_name: null,
    confirmation_enabled: false,
    confirmation_lead_minutes: 240,
    confirmation_response_window_minutes: 240,
    unconfirmed_action: "MANUAL" as const,
    manual_follow_up_on_no_answer: true,
  };
  const [open, setOpen] = useState("assistant");
  const section = (id: string) => () => setOpen(open === id ? "" : id);
  return (
    <section className="max-w-4xl space-y-5">
      <header>
        <p className="text-sm font-semibold tracking-wide text-zinc-500">
          HelloPx · DOCTOR
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
          Capacita a tu asistente
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          Enséñale cómo orientar a tus pacientes y cuándo pedirte ayuda.
        </p>
      </header>
      <Section
        title="Tu asistente"
        summary={`${s.assistant_name || "Sin nombre"} · ${s.confirmation_enabled ? "Confirmación activa" : "Confirmación desactivada"}`}
        open={open === "assistant"}
        toggle={section("assistant")}
      >
        <Form action={saveAssistantSettings} doctorId={doctorId}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre del asistente">
              <input
                name="assistant_name"
                className={input}
                defaultValue={s.assistant_name ?? ""}
              />
            </Field>
            <Field label="¿Quieres que confirme las citas?">
              <select
                name="confirmation_enabled"
                className={input}
                defaultValue={s.confirmation_enabled ? "true" : "false"}
              >
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            </Field>
            <Field label="¿Cuándo debe llamar?">
              <select
                name="confirmation_lead_minutes"
                className={input}
                defaultValue={String(s.confirmation_lead_minutes ?? 240)}
              >
                <option value="240">El mismo día</option>
                <option value="1440">1 día antes</option>
                <option value="2880">2 días antes</option>
              </select>
            </Field>
            <Field label="¿Cuánto esperar después del recordatorio?">
              <select
                name="confirmation_response_window_minutes"
                className={input}
                defaultValue={String(
                  s.confirmation_response_window_minutes ?? 240,
                )}
              >
                <option value="120">2 horas</option>
                <option value="240">4 horas</option>
                <option value="480">8 horas</option>
              </select>
            </Field>
          </div>
          <input
            type="hidden"
            name="manual_follow_up_on_no_answer"
            value={String(s.manual_follow_up_on_no_answer)}
          />
          <Field label="Si el paciente no responde, ¿qué debe hacer?">
            <select
              name="unconfirmed_action"
              className={input}
              defaultValue={s.unconfirmed_action ?? "MANUAL"}
            >
              <option value="CANCEL">Cancelar la cita automáticamente</option>
              <option value="MANUAL">
                Dejarla pendiente para que yo decida
              </option>
            </select>
          </Field>
        </Form>
        <div className="mt-8 border-t border-zinc-100 pt-6">
          <OfficeProfile doctorId={doctorId} doctor={doctor} />
        </div>
      </Section>
      <Section
        title="Horario y tipos de cita"
        summary={`${appointmentTypes.length} tipos de cita`}
        open={open === "appointments"}
        toggle={section("appointments")}
      >
        <DoctorScheduleForm
          doctorId={doctorId}
          schedule={schedule}
          recurringUnavailability={recurringUnavailability}
          showRecurringUnavailability
        />
        <div className="mt-8 border-t border-zinc-100 pt-6">
          <h3 className="font-semibold">Tipos de cita</h3>
          <div className="mt-4">
            <Types doctorId={doctorId} items={appointmentTypes} />
          </div>
        </div>
      </Section>
      <Section
        title="Qué debe preguntar"
        summary={`${intakeFields.length} preguntas`}
        open={open === "questions"}
        toggle={section("questions")}
      >
        <Questions doctorId={doctorId} items={intakeFields} />
      </Section>
      <Section
        title="Anticipos"
        summary={`${depositRules.length} reglas de anticipo`}
        open={open === "deposits"}
        toggle={section("deposits")}
      >
        <p className="text-sm leading-6 text-zinc-600">
          Define cuándo pedir anticipo. Si aplican varias reglas, HelloPx usa la
          primera.
        </p>
        <DepositRules
          doctorId={doctorId}
          items={depositRules}
          appointmentTypes={appointmentTypes}
          intakeFields={intakeFields}
        />
        <div className="mt-8 border-t border-zinc-100 pt-6">
          <h3 className="font-semibold">Datos para recibir el anticipo</h3>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            Banco, titular, CLABE y cuenta son los datos de depósito. Las
            instrucciones se agregan al mensaje generado por defecto. El mensaje
            personalizado opcional reemplaza ese mensaje y admite variables.
          </p>
          <Form
            action={savePaymentInstructions}
            doctorId={doctorId}
            label="Guardar datos de anticipo"
          >
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Banco">
                <input
                  name="bank_name"
                  className={input}
                  defaultValue={payment?.bank_name ?? ""}
                />
              </Field>
              <Field label="Titular">
                <input
                  name="account_holder"
                  className={input}
                  defaultValue={payment?.account_holder ?? ""}
                />
              </Field>
              <Field label="CLABE">
                <input
                  name="clabe"
                  className={input}
                  defaultValue={payment?.clabe ?? ""}
                />
              </Field>
              <Field label="Número de cuenta">
                <input
                  name="account_number"
                  className={input}
                  defaultValue={payment?.account_number ?? ""}
                />
              </Field>
              <Field label="Instrucciones adicionales">
                <textarea
                  name="instructions"
                  className={input}
                  rows={3}
                  defaultValue={payment?.instructions ?? ""}
                />
              </Field>
              <Field label="Mensaje personalizado opcional">
                <textarea
                  name="message_template"
                  className={input}
                  rows={3}
                  defaultValue={payment?.message_template ?? ""}
                />
              </Field>
            </div>
          </Form>
        </div>
      </Section>
      <Section
        title="Qué puede responder"
        summary={`${knowledgeItems.length} temas de información`}
        open={open === "knowledge"}
        toggle={section("knowledge")}
      >
        <Knowledge doctorId={doctorId} items={knowledgeItems} />
      </Section>
    </section>
  );
}
