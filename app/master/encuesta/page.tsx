import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

type Search = Promise<{ from?: string; to?: string; specialty?: string; interest?: string; version?: string; id?: string }>
type Row = {
  id: string; started_at: string; completed_at: string | null; status: string;
  survey_version: string | null; missed_calls_volume: string | null; assistant_concerns: string[] | null;
  specialty: string | null; specialty_other: string | null; call_handler: string | null;
  appointment_channels: string[] | null; missed_calls: string | null; obstacle: string | null;
  obstacle_other: string | null; missed_call_followup: string | null; assistant_usefulness: string | null;
  wants_demo: boolean | null; demo_call_clicked_at: string | null; commercial_interest: string | null;
  contact_name: string | null; contact_method: string | null; contact_value: string | null; contact_consent_at: string | null
}

const label: Record<string, string> = { personalized_demo: 'Demo personalizada', information: 'Más información', none: 'Sin interés', email: 'Correo', phone: 'Teléfono', whatsapp: 'WhatsApp' }
const date = (value: string | null) => value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mazatlan' }).format(new Date(value)) : '—'
const count = (rows: Row[], predicate: (row: Row) => boolean) => rows.filter(predicate).length

function Distribution({ title, values }: { title: string; values: (string | null)[] }) {
  const entries = Object.entries(values.reduce<Record<string, number>>((acc, value) => { if (value) acc[value] = (acc[value] || 0) + 1; return acc }, {})).sort((a, b) => b[1] - a[1])
  const total = values.filter(Boolean).length
  return <section className="rounded-xl bg-white p-5 shadow-sm"><h2 className="font-semibold text-zinc-950">{title}</h2>{entries.length ? <div className="mt-5 space-y-4">{entries.map(([value, amount]) => <div key={value}><div className="mb-1 flex justify-between gap-3 text-sm"><span>{value}</span><span className="tabular-nums text-zinc-500">{amount}</span></div><div className="h-2 rounded-full bg-zinc-100"><div className="h-2 rounded-full bg-[#258db0]" style={{ width: `${amount / total * 100}%` }} /></div></div>)}</div> : <p className="mt-4 text-sm text-zinc-500">Sin respuestas aún.</p>}</section>
}

export default async function MasterSurveyPage({ searchParams }: { searchParams: Search }) {
  await requireRole('MASTER')
  const filters = await searchParams
  const admin = createAdminClient()
  let query = admin.from('commercial_survey_responses').select('id, started_at, completed_at, status, survey_version, specialty, specialty_other, call_handler, appointment_channels, missed_calls, obstacle, obstacle_other, missed_call_followup, assistant_usefulness, missed_calls_volume, assistant_concerns, wants_demo, demo_call_clicked_at, commercial_interest, contact_name, contact_method, contact_value, contact_consent_at').order('started_at', { ascending: false }).limit(2000)
  if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)) query = query.gte('started_at', `${filters.from}T00:00:00`)
  if (filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)) query = query.lte('started_at', `${filters.to}T23:59:59`)
  if (filters.specialty) query = query.eq('specialty', filters.specialty)
  if (filters.interest) query = query.eq('commercial_interest', filters.interest)
  if (filters.version === 'v1' || filters.version === 'v2') query = query.eq('survey_version', filters.version)
  const { data, error } = await query
  if (error) throw new Error('No se pudieron cargar las respuestas de la encuesta.')
  const rows = (data || []) as Row[]
  const completed = count(rows, row => row.status === 'completed')
  const heard = count(rows, row => row.wants_demo === true)
  const selected = rows.find(row => row.id === filters.id)
  const metrics = [
    ['Encuestas iniciadas', rows.length], ['Encuestas completadas', completed], ['Tasa de finalización', `${rows.length ? Math.round(completed / rows.length * 100) : 0}%`],
    ['Aceptaron escuchar HelloPx', `${completed ? Math.round(heard / completed * 100) : 0}%`],
    ['Clics en llamada de prueba', count(rows, row => !!row.demo_call_clicked_at)],
    ['Demos personalizadas', count(rows, row => row.commercial_interest === 'personalized_demo')],
    ['Solicitudes de información', count(rows, row => row.commercial_interest === 'information')],
  ]
  return <main className="min-h-screen bg-zinc-50 px-5 py-10 text-zinc-900 sm:px-8"><div className="mx-auto max-w-[1500px]"><header><p className="text-sm font-semibold text-zinc-500">HelloPx · MASTER</p><h1 className="mt-2 text-3xl font-semibold">Encuesta</h1><p className="mt-2 text-sm text-zinc-600">Validación comercial y contactos interesados.</p></header><nav aria-label="Secciones MASTER" className="mt-7 flex gap-2 border-b border-zinc-200 text-sm font-medium"><Link href="/master/doctors" className="px-4 py-3 text-zinc-600 hover:text-zinc-950">Doctores</Link><Link href="/master/encuesta" aria-current="page" className="border-b-2 border-zinc-900 px-4 py-3">Encuesta</Link></nav>
    <form className="mt-8 flex flex-wrap items-end gap-3 rounded-xl bg-white p-5 shadow-sm"><label className="text-sm">Desde<input name="from" type="date" defaultValue={filters.from || ''} className="mt-1 block rounded-lg border border-zinc-300 p-2" /></label><label className="text-sm">Hasta<input name="to" type="date" defaultValue={filters.to || ''} className="mt-1 block rounded-lg border border-zinc-300 p-2" /></label><label className="text-sm">Versión<select name="version" defaultValue={filters.version || ''} className="mt-1 block rounded-lg border border-zinc-300 bg-white p-2"><option value="">Todas</option><option value="v1">V1</option><option value="v2">V2</option></select></label><label className="text-sm">Especialidad<select name="specialty" defaultValue={filters.specialty || ''} className="mt-1 block rounded-lg border border-zinc-300 bg-white p-2"><option value="">Todas</option>{['Medicina general', 'Ginecología y obstetricia', 'Pediatría', 'Dermatología', 'Traumatología y ortopedia', 'Otra'].map(value => <option key={value}>{value}</option>)}</select></label><label className="text-sm">Interés<select name="interest" defaultValue={filters.interest || ''} className="mt-1 block rounded-lg border border-zinc-300 bg-white p-2"><option value="">Todos</option><option value="personalized_demo">Demo personalizada</option><option value="information">Más información</option><option value="none">Sin interés</option></select></label><button className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Aplicar filtros</button><Link href="/master/encuesta" className="px-2 py-2 text-sm text-zinc-600 underline">Limpiar</Link></form>
    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{metrics.map(([title, value]) => <section key={title} className="rounded-xl bg-white p-5 shadow-sm"><p className="text-sm text-zinc-600">{title}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p></section>)}</div>
    <div className="mt-6 grid gap-4 lg:grid-cols-2"><Distribution title="Especialidad" values={rows.map(row => row.specialty)} /><Distribution title="Frecuencia de llamadas sin contestar" values={rows.map(row => row.missed_calls)} /><Distribution title="Volumen semanal estimado" values={rows.map(row => row.missed_calls_volume)} /><Distribution title="Preocupaciones sobre el asistente" values={rows.flatMap(row => row.assistant_concerns || [])} /><Distribution title="Principales obstáculos" values={rows.map(row => row.obstacle)} /><Distribution title="Utilidad percibida (V1)" values={rows.filter(row => !row.survey_version || row.survey_version === 'v1').map(row => row.assistant_usefulness)} /></div>
    <section className="mt-6 overflow-hidden rounded-xl bg-white shadow-sm"><div className="border-b border-zinc-200 p-5"><h2 className="font-semibold">Respuestas y contactos</h2><p className="mt-1 text-sm text-zinc-500">{rows.length} registros en el periodo seleccionado</p></div><div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-zinc-50 text-zinc-500"><tr><th className="p-4">Inicio</th><th className="p-4">Versión</th><th className="p-4">Estado</th><th className="p-4">Especialidad</th><th className="p-4">Interés</th><th className="p-4">Contacto</th><th className="p-4">Detalle</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-zinc-100"><td className="p-4 whitespace-nowrap">{date(row.started_at)}</td><td className="p-4 uppercase">{row.survey_version || 'v1'}</td><td className="p-4">{row.status === 'completed' ? 'Completada' : 'Iniciada'}</td><td className="p-4">{row.specialty || '—'}</td><td className="p-4">{label[row.commercial_interest || ''] || '—'}</td><td className="p-4">{row.contact_name ? <><span className="font-medium">{row.contact_name}</span><br />{row.contact_value}</> : '—'}</td><td className="p-4"><Link className="font-medium text-[#17779a] underline" href={`?${new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([key, value]) => key !== 'id' && value)), id: row.id }).toString()}#detalle`}>Ver respuesta</Link></td></tr>)}</tbody></table>{!rows.length && <p className="p-6 text-sm text-zinc-500">No hay respuestas para estos filtros.</p>}</div></section>
    {selected && <section id="detalle" className="mt-6 rounded-xl bg-white p-6 shadow-sm"><div className="flex items-start justify-between gap-4"><h2 className="text-xl font-semibold">Detalle de respuesta</h2><Link href="/master/encuesta" className="text-sm underline">Cerrar</Link></div><dl className="mt-6 grid gap-5 sm:grid-cols-2">{[['Versión', (selected.survey_version || 'v1').toUpperCase()], ['Inicio', date(selected.started_at)], ['Finalización', date(selected.completed_at)], ['Especialidad', [selected.specialty, selected.specialty_other].filter(Boolean).join(': ')], ['Atención de llamadas', selected.call_handler], ['Medios para citas', selected.appointment_channels?.join(', ')], ['Frecuencia de llamadas sin contestar', selected.missed_calls], ['Volumen semanal estimado', selected.missed_calls_volume], ['Obstáculo', [selected.obstacle, selected.obstacle_other].filter(Boolean).join(': ')], ['Seguimiento de llamadas', selected.missed_call_followup], ['Preocupaciones', selected.assistant_concerns?.join(', ')], ['Utilidad del asistente (V1)', selected.assistant_usefulness], ['Invitación aceptada', selected.wants_demo === null ? 'Pendiente' : selected.wants_demo ? 'Sí' : 'No'], ['Clic en llamada', date(selected.demo_call_clicked_at)], ['Interés', label[selected.commercial_interest || ''] || 'Pendiente'], ['Nombre', selected.contact_name], ['Medio de contacto', label[selected.contact_method || ''] || null], ['Contacto', selected.contact_value], ['Consentimiento', date(selected.contact_consent_at)]].map(([key, value]) => <div key={key}><dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{key}</dt><dd className="mt-1 break-words text-sm">{value || '—'}</dd></div>)}</dl></section>}
  </div></main>
}
