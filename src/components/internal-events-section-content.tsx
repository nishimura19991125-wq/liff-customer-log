import type {
  InternalEventsContent,
  InternalEventsScheduleStep,
} from "@/lib/internal-events-sections";

function ScheduleStepCard({ step }: { step: InternalEventsScheduleStep }) {
  return (
    <li className="rounded-2xl border border-slate-200/90 bg-white px-4 py-3.5 shadow-sm ring-1 ring-slate-100 dark:border-slate-700 dark:bg-slate-900/40 dark:ring-slate-800">
      <div className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-[15px] font-extrabold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
          aria-hidden
        >
          {step.mark}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <p className="text-[15px] font-bold leading-snug text-slate-900 dark:text-slate-100">
              {step.title}
            </p>
            {step.duration ? (
              <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                {step.duration}
              </span>
            ) : null}
          </div>
          {step.notes?.length ? (
            <ul className="mt-2 space-y-1">
              {step.notes.map((note) => (
                <li
                  key={note}
                  className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-400"
                >
                  {note}
                </li>
              ))}
            </ul>
          ) : null}
          {step.subItems?.length ? (
            <ul className="mt-2.5 space-y-1.5 border-l-2 border-emerald-200 pl-3 dark:border-emerald-900/70">
              {step.subItems.map((item) => (
                <li
                  key={item}
                  className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300"
                >
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function InternalEventsSectionContent({
  content,
}: {
  content: InternalEventsContent;
}) {
  if (content.type === "text") {
    return (
      <div className="space-y-4">
        {content.paragraphs.map((paragraph) => (
          <p
            key={paragraph}
            className="text-[14px] leading-relaxed text-slate-700 dark:text-slate-200"
          >
            {paragraph}
          </p>
        ))}
      </div>
    );
  }

  if (content.type === "bullet-list") {
    return (
      <div>
        {content.heading ? (
          <p className="mb-4 text-[13px] font-extrabold tracking-wide text-emerald-800 dark:text-emerald-300">
            {content.heading}
          </p>
        ) : null}
        <ul className="grid gap-2 sm:grid-cols-2">
          {content.items.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100 dark:bg-slate-900/50 dark:ring-slate-800"
            >
              <span
                className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500"
                aria-hidden
              />
              <span className="text-[14px] font-medium leading-snug text-slate-800 dark:text-slate-100">
                {item}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 inline-flex rounded-full bg-emerald-600 px-3 py-1 text-[12px] font-extrabold tracking-wide text-white shadow-sm">
        {content.timeRange}
      </div>
      <ol className="flex flex-col gap-3">
        {content.steps.map((step) => (
          <ScheduleStepCard key={step.mark} step={step} />
        ))}
      </ol>
    </div>
  );
}
