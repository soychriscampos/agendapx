type DoctorPlaceholderProps = {
  eyebrow: string
  title: string
  description: string
}

export function DoctorPlaceholder({ eyebrow, title, description }: DoctorPlaceholderProps) {
  return (
    <section className="max-w-3xl">
      <p className="text-sm font-semibold tracking-wide text-zinc-500">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">{title}</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-600">{description}</p>
      <div className="mt-8 rounded-xl border border-dashed border-zinc-300 bg-white px-5 py-6 text-sm text-zinc-500">
        Esta sección estará disponible próximamente.
      </div>
    </section>
  )
}
