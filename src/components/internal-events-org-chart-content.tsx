import {
  ORG_CHART_DATA,
  type OrgChartUnit,
} from "@/lib/org-chart-data";

function StaffList({ staff }: { staff: string[] }) {
  if (!staff.length) return null;

  return (
    <ul className="space-y-1.5">
      {staff.map((person) => (
        <li
          key={person}
          className="flex items-start gap-2 text-[14px] font-medium leading-snug text-slate-800 dark:text-slate-100"
        >
          <span
            className="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-500"
            aria-hidden
          />
          <span>{person}</span>
        </li>
      ))}
    </ul>
  );
}

function OrgChartUnitCard({ unit }: { unit: OrgChartUnit }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/40">
      <div className="border-b border-slate-100 bg-slate-50 px-3.5 py-2.5 dark:border-slate-700 dark:bg-slate-900/60">
        <p className="text-[14px] font-extrabold leading-snug text-slate-900 dark:text-slate-100">
          {unit.title}
        </p>
        {unit.subtitle ? (
          <p className="mt-0.5 text-[12px] font-semibold text-emerald-800 dark:text-emerald-300">
            {unit.subtitle}
          </p>
        ) : null}
      </div>
      <div className="space-y-3 px-3.5 py-3">
        <StaffList staff={unit.staff} />
        {unit.branches?.map((branch) => (
          <div
            key={branch.title}
            className="rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2.5 dark:border-emerald-900/40 dark:bg-emerald-950/20"
          >
            <p className="mb-2 text-[13px] font-bold text-emerald-900 dark:text-emerald-200">
              {branch.title}
            </p>
            <StaffList staff={branch.staff} />
          </div>
        ))}
      </div>
    </div>
  );
}

function LeadershipChain({ items }: { items: string[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {items.map((item, index) => (
        <li
          key={item}
          className="relative rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center dark:border-emerald-900/50 dark:bg-emerald-950/30"
        >
          <p className="text-[14px] font-bold leading-snug text-emerald-950 dark:text-emerald-100">
            {item}
          </p>
          {index < items.length - 1 ? (
            <span
              className="absolute -bottom-2 left-1/2 z-10 -translate-x-1/2 text-[12px] font-bold text-emerald-500"
              aria-hidden
            >
              ▼
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function SimpleListCard({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/40">
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/60">
        <p className="text-[14px] font-extrabold text-slate-900 dark:text-slate-100">
          {title}
        </p>
      </div>
      <ul className="space-y-2 px-4 py-3">
        {items.map((item) => (
          <li
            key={item}
            className="text-[13px] font-medium leading-relaxed text-slate-700 dark:text-slate-200"
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function InternalEventsOrgChartContent() {
  const data = ORG_CHART_DATA;

  return (
    <div className="flex flex-col gap-4">
      <section>
        <p className="mb-3 text-[12px] font-extrabold tracking-wide text-emerald-800 uppercase dark:text-emerald-300">
          経営体制
        </p>
        <LeadershipChain items={data.leadership} />
      </section>

      <SimpleListCard title="コーチ・相談" items={data.coaches} />

      {data.headquarters.map((hq) => (
        <section key={hq.title}>
          <p className="mb-3 text-[15px] font-extrabold text-slate-900 dark:text-slate-100">
            {hq.title}
          </p>
          <div className="flex flex-col gap-3">
            {hq.departments.map((dept) => (
              <OrgChartUnitCard key={dept.title} unit={dept} />
            ))}
          </div>
        </section>
      ))}

      <SimpleListCard title="★社外顧問" items={data.externalAdvisors} />

      <SimpleListCard
        title="★トラーチ倶楽部加盟企業"
        items={data.memberCompanies}
      />
    </div>
  );
}
