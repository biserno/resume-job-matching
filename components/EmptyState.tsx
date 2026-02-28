export function EmptyState({
  title,
  description,
  cta,
}: {
  title: string;
  description: string;
  cta?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-10 text-center">
      <div className="mx-auto max-w-md">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-neutral-600">{description}</p>
        {cta ? <div className="mt-5 flex justify-center">{cta}</div> : null}
      </div>
    </div>
  );
}