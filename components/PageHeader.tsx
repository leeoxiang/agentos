export function PageHeader({
  eyebrow,
  title,
  children,
  right,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="border-b border-ink-700 bg-ink-900/60 px-6 py-6 backdrop-blur">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="label">{eyebrow}</div>
          <h1 className="mt-1.5 text-[24px] font-semibold leading-none tracking-tight text-ash-100">
            {title}
          </h1>
          {children ? (
            <p className="mt-2.5 max-w-[560px] text-[13px] leading-relaxed text-ash-300">{children}</p>
          ) : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
    </div>
  );
}

export function PageBody({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1120px] px-6 py-6">{children}</div>;
}
