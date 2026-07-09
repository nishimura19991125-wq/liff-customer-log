import type {
  InternalEventsContent,
  InternalEventsDayBlock,
  InternalEventsDaySection,
  InternalEventsScheduleStep,
} from "@/lib/internal-events-sections";

function isItemSectionHeading(item: string) {
  return item.startsWith("■");
}

function groupItemsByHeading(items: string[]) {
  const groups: { heading?: string; items: string[] }[] = [];
  let current: { heading?: string; items: string[] } | null = null;

  for (const item of items) {
    if (isItemSectionHeading(item)) {
      current = { heading: item, items: [] };
      groups.push(current);
      continue;
    }

    if (current) {
      current.items.push(item);
      continue;
    }

    groups.push({ items: [item] });
  }

  return groups;
}

function ItemBulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li
          key={item}
          className="flex items-start gap-2 text-[13px] leading-relaxed text-slate-700 dark:text-slate-300"
        >
          <span
            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500"
            aria-hidden
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function DaySectionCard({ section }: { section: InternalEventsDaySection }) {
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white px-4 py-3.5 shadow-sm ring-1 ring-slate-100 dark:border-slate-700 dark:bg-slate-900/40 dark:ring-slate-800">
      {section.title ? (
        <p className="text-[15px] font-bold leading-snug text-slate-900 dark:text-slate-100">
          {section.title}
        </p>
      ) : null}
      {section.notes?.length ? (
        <ul className={`space-y-1 ${section.title ? "mt-2" : ""}`}>
          {section.notes.map((note) => (
            <li
              key={note}
              className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-400"
            >
              {note}
            </li>
          ))}
        </ul>
      ) : null}
      {section.steps?.length ? (
        <ol className={`flex flex-col gap-3 ${section.title ? "mt-3" : ""}`}>
          {section.steps.map((step) => (
            <ScheduleStepCard key={step.mark} step={step} nested />
          ))}
        </ol>
      ) : null}
      {section.items?.length ? (
        <div
          className={`flex flex-col gap-3 ${section.title || section.notes?.length ? "mt-2.5" : ""}`}
        >
          {groupItemsByHeading(section.items).map((group) => {
            if (group.heading) {
              return (
                <div
                  key={group.heading}
                  className="rounded-xl bg-emerald-50/90 px-3.5 py-3 ring-1 ring-emerald-100 dark:bg-emerald-950/35 dark:ring-emerald-900/60"
                >
                  <p className="text-[15px] font-extrabold leading-snug tracking-wide text-emerald-800 dark:text-emerald-300">
                    {group.heading}
                  </p>
                  {group.items.length ? (
                    <div className="mt-2.5 border-t border-emerald-100 pt-2.5 dark:border-emerald-900/70">
                      <ItemBulletList items={group.items} />
                    </div>
                  ) : null}
                </div>
              );
            }

            return <ItemBulletList key={group.items[0]} items={group.items} />;
          })}
        </div>
      ) : null}
    </div>
  );
}

function DayScheduleBlock({ block }: { block: InternalEventsDayBlock }) {
  const multiSection = block.sections.length > 1;

  return (
    <section>
      <div className="mb-3 inline-flex rounded-full bg-emerald-600 px-3 py-1 text-[12px] font-extrabold tracking-wide text-white shadow-sm">
        {block.timeRange}
      </div>
      <div
        className={
          multiSection ? "grid gap-3 sm:grid-cols-2" : "flex flex-col gap-3"
        }
      >
        {block.sections.map((section, index) => (
          <DaySectionCard
            key={`${block.timeRange}-${section.title ?? index}`}
            section={section}
          />
        ))}
      </div>
    </section>
  );
}

function ScheduleStepCard({
  step,
  nested = false,
}: {
  step: InternalEventsScheduleStep;
  nested?: boolean;
}) {
  const cardClass = nested
    ? "rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-100 dark:bg-slate-950/40 dark:ring-slate-800"
    : "rounded-2xl border border-slate-200/90 bg-white px-4 py-3.5 shadow-sm ring-1 ring-slate-100 dark:border-slate-700 dark:bg-slate-900/40 dark:ring-slate-800";

  return (
    <li className={cardClass}>
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

  if (content.type === "day-schedule") {
    return (
      <div className="flex flex-col gap-6">
        {content.blocks.map((block) => (
          <DayScheduleBlock key={block.timeRange} block={block} />
        ))}
      </div>
    );
  }

  if (content.type === "schedule") {
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

  return null;
}
