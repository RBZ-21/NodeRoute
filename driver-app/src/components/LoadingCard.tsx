export function LoadingCard() {
  return (
    <div className="animate-pulse rounded-3xl bg-white p-4 shadow-card">
      <div className="h-4 w-24 rounded-full bg-slate-200" />
      <div className="mt-3 h-6 w-2/3 rounded-full bg-slate-200" />
      <div className="mt-4 h-4 w-full rounded-full bg-slate-100" />
      <div className="mt-2 h-4 w-5/6 rounded-full bg-slate-100" />
      <div className="mt-5 h-12 rounded-2xl bg-slate-200" />
    </div>
  );
}
