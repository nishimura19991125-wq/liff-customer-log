import {
  ORG_CHART_DATA,
  type OrgChartUnit,
} from "@/lib/org-chart-data";

type ParsedStaff = {
  raw: string;
  isTl: boolean;
  label: string;
  concurrent: boolean;
};

function parseStaffEntry(entry: string): ParsedStaff {
  const concurrent = /（兼）|\(兼\)/.test(entry);
  const cleaned = entry.replace(/（兼）|\(兼\)/g, "").trim();
  const tlMatch = /^TL\s+(.+)$/.exec(cleaned);

  if (tlMatch) {
    return {
      raw: entry,
      isTl: true,
      label: tlMatch[1]!.trim(),
      concurrent,
    };
  }

  return {
    raw: entry,
    isTl: false,
    label: cleaned,
    concurrent,
  };
}

function splitStaff(staff: string[]) {
  const parsed = staff.map(parseStaffEntry);
  return {
    leaders: parsed.filter((person) => person.isTl),
    members: parsed.filter((person) => !person.isTl),
  };
}

function ConcurrentBadge() {
  return (
    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900/50">
      兼
    </span>
  );
}

function TlBadge() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-[11px] font-extrabold tracking-wide text-white shadow-sm dark:bg-emerald-500">
      TL
    </span>
  );
}

function LeaderRow({ person }: { person: ParsedStaff }) {
  return (
    <li className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 ring-1 ring-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-950/35 dark:ring-emerald-900/40">
      <TlBadge />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold tracking-wide text-emerald-700 uppercase dark:text-emerald-300">
          チームリーダー
        </p>
        <p className="text-[15px] font-extrabold leading-snug text-emerald-950 dark:text-emerald-50">
          {person.label}
        </p>
      </div>
      {person.concurrent ? <ConcurrentBadge /> : null}
    </li>
  );
}

function MemberRow({ person }: { person: ParsedStaff }) {
  return (
    <li className="flex items-start gap-2 pl-1 text-[14px] font-medium leading-snug text-slate-800 dark:text-slate-100">
      <span
        className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500"
        aria-hidden
      />
      <span className="flex flex-wrap items-center gap-1.5">
        <span>{person.label}</span>
        {person.concurrent ? <ConcurrentBadge /> : null}
      </span>
    </li>
  );
}

function StaffList({ staff }: { staff: string[] }) {
  if (!staff.length) return null;

  const { leaders, members } = splitStaff(staff);

  return (
    <div className="space-y-3">
      {leaders.length ? (
        <ul className="space-y-2">
          {leaders.map((person) => (
            <LeaderRow key={person.raw} person={person} />
          ))}
        </ul>
      ) : null}
      {members.length ? (
        <div>
          {leaders.length ? (
            <p className="mb-2 text-[11px] font-bold tracking-wide text-slate-500 uppercase dark:text-slate-400">
              メンバー
            </p>
          ) : null}
          <ul className="space-y-1.5">
            {members.map((person) => (
              <MemberRow key={person.raw} person={person} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
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
          <div className="mt-2 inline-flex items-center gap-2 rounded-lg bg-emerald-600/10 px-2.5 py-1.5 ring-1 ring-emerald-200/80 dark:bg-emerald-500/10 dark:ring-emerald-800/50">
            <span className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white dark:bg-emerald-500">
              責任者
            </span>
            <p className="text-[13px] font-bold text-emerald-900 dark:text-emerald-100">
              {unit.subtitle.replace(/^責任者\s*/, "")}
            </p>
          </div>
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
