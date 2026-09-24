export default function Loading() {
  return (
    <section aria-busy="true" aria-label="Cargando sección" className="max-w-7xl space-y-8">
      <div className="space-y-3">
        <div className="h-3 w-28 rounded-full bg-zinc-200" />
        <div className="h-9 w-56 rounded-lg bg-zinc-200" />
        <div className="h-4 w-full max-w-xl rounded-full bg-zinc-100" />
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-5 sm:p-6">
        <div className="space-y-4">
          <div className="h-4 w-40 rounded-full bg-zinc-100" />
          <div className="h-12 w-full rounded-lg bg-zinc-100" />
          <div className="h-12 w-full rounded-lg bg-zinc-100" />
          <div className="h-12 w-4/5 rounded-lg bg-zinc-100" />
        </div>
      </div>
    </section>
  )
}
