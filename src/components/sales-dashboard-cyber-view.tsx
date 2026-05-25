"use client";

import { LiffCard } from "@/components/liff-chrome";

export type DashboardPeriod = "current" | "previous";
export type DashboardDepartment = "pt" | "sales" | "apo";

export type DashboardKpi = {
  pt: number;
  salesAmount: number;
  contractCount: number;
  avgAmount: number;
};

export type RankingRow = {
  rank: number;
  staffName: string;
  pt: number;
  salesAmount: number;
  contractCount: number;
  sharePercent: number;
  isSelf: boolean;
  isPodium: boolean;
};

export type ApoRankingRow = {
  rank: number;
  staffName: string;
  apoCount: number;
  sharePercent: number;
  isSelf: boolean;
  isPodium: boolean;
};

export type DashboardPayload = {
  staffName: string;
  period: DashboardPeriod;
  periodLabel: string;
  periodHint: string;
  kpi: DashboardKpi;
  ranking: RankingRow[];
  apoEnabled: boolean;
  apoReady: boolean;
  apoError: string | null;
  apoKpi: { totalApoCount: number } | null;
  apoRanking: ApoRankingRow[];
};

const DEPARTMENT_TABS: Array<{ id: DashboardDepartment; label: string }> = [
  { id: "pt", label: "総合PTランキング" },
  { id: "sales", label: "売上金額部門" },
  { id: "apo", label: "アポ件数部門" },
];

function formatYen(n: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatPt(n: number): string {
  return new Intl.NumberFormat("ja-JP").format(Math.round(n));
}

function formatCount(n: number): string {
  return new Intl.NumberFormat("ja-JP").format(Math.round(n));
}

function percentOfLeader(value: number, leader: number): number {
  if (leader <= 0) return value > 0 ? 100 : 0;
  return Math.min(100, Math.round((value / leader) * 1000) / 10);
}

function tabClass(active: boolean): string {
  return `shrink-0 rounded-2xl px-4 py-2.5 text-[14px] transition-all duration-300 active:scale-[0.98] ${
    active
      ? "cyber-tab-active"
      : "bg-slate-100 font-semibold text-slate-600 dark:bg-slate-800/80 dark:text-slate-400 dark:border dark:border-slate-700/60"
  }`;
}

type PersonalKpi = {
  totalPt: number;
  salesPt: number;
  apoPt: number;
  salesAmount: number;
  apoCount: number;
  contractCount: number;
};

function resolvePersonalKpi(data: DashboardPayload): PersonalKpi {
  const self = data.ranking.find((r) => r.isSelf);
  const selfApo = data.apoRanking.find((r) => r.isSelf);
  const salesPt = self?.pt ?? 0;
  const apoPt = selfApo?.apoCount ?? 0;
  return {
    totalPt: salesPt + apoPt,
    salesPt,
    apoPt,
    salesAmount: self?.salesAmount ?? 0,
    apoCount: apoPt,
    contractCount: self?.contractCount ?? 0,
  };
}

function PersonalKpiHero({ personal, periodLabel }: { personal: PersonalKpi; periodLabel: string }) {
  return (
    <section className="relative overflow-hidden rounded-xl border border-slate-100 bg-white p-6 text-center shadow-sm dark:border-emerald-500/20 dark:bg-slate-900/60 dark:shadow-[0_0_12px_rgba(16,185,129,0.08)]">
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-emerald-50/80 via-transparent to-transparent dark:from-emerald-400/10"
        aria-hidden
      />
      <p className="relative text-[12px] font-medium tracking-wide text-slate-500 dark:text-emerald-200/70">
        {periodLabel}の獲得総PT
      </p>
      <p className="relative mt-2 text-[3rem] font-extrabold leading-none tracking-tight text-emerald-600 sm:text-[3.25rem] dark:font-black dark:text-emerald-400 dark:drop-shadow-[0_0_28px_rgba(52,211,153,0.55)]">
        {formatPt(personal.totalPt)}
        <span className="ml-2 text-[1.25rem] font-bold sm:text-[1.35rem]">PT</span>
      </p>
      <p className="relative mt-2 text-[13px] text-slate-500 dark:text-slate-300">
        （内訳: 売上 {formatPt(personal.salesPt)}pt + アポ {formatPt(personal.apoPt)}pt）
      </p>
      <div className="relative mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px] text-slate-500 dark:text-slate-400">
        <span>
          当月売上{" "}
          <span className="font-medium text-slate-600 dark:font-semibold dark:text-slate-200">
            {formatYen(personal.salesAmount)}
          </span>
        </span>
        <span>
          アポ{" "}
          <span className="font-medium text-slate-600 dark:font-semibold dark:text-slate-200">
            {formatCount(personal.apoCount)}件
          </span>
        </span>
        <span>
          契約{" "}
          <span className="font-medium text-slate-600 dark:font-semibold dark:text-slate-200">
            {formatCount(personal.contractCount)}件
          </span>
        </span>
      </div>
    </section>
  );
}

function PtGauge({ percent }: { percent: number }) {
  const w = Math.max(2, Math.min(100, percent));
  return (
    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div
        className="h-full rounded-full bg-emerald-500 transition-all duration-500 dark:bg-emerald-400 dark:shadow-[0_0_10px_rgba(52,211,153,0.7)]"
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

function podiumCardShell(rank: number): string {
  const base = "relative rounded-[1.35rem] border px-4 py-4 ";
  if (rank === 1) {
    return `${base} border-amber-200 bg-amber-50/70 shadow-sm dark:border-amber-400/40 dark:bg-transparent dark:shadow-[0_0_24px_rgba(234,179,8,0.25)]`;
  }
  if (rank === 2) {
    return `${base} border-slate-200 bg-slate-100/80 shadow-sm dark:border-slate-400/40 dark:bg-transparent dark:shadow-[0_0_20px_rgba(148,163,184,0.3)]`;
  }
  if (rank === 3) {
    return `${base} border-orange-200 bg-orange-50/60 shadow-sm dark:border-amber-600/35 dark:bg-transparent dark:shadow-[0_0_20px_rgba(180,83,9,0.25)]`;
  }
  return `${base} border-slate-100 bg-white dark:border-slate-700/60 dark:bg-transparent`;
}

function podiumNameClass(rank: number): string {
  if (rank === 1) return "text-amber-700 dark:text-white";
  if (rank === 2) return "text-slate-800 dark:text-white";
  if (rank === 3) return "text-orange-900 dark:text-white";
  return "text-slate-800 dark:text-white";
}

function ptValueClass(): string {
  return "font-bold text-emerald-600 dark:font-black dark:text-emerald-400 dark:drop-shadow-[0_0_16px_rgba(52,211,153,0.45)]";
}

function rankBadgeClass(rank: number): string {
  if (rank === 1) return "bg-amber-400 text-amber-950 shadow-[0_0_10px_rgba(234,179,8,0.5)]";
  if (rank === 2) return "bg-slate-300 text-slate-800 dark:bg-slate-400 dark:text-slate-900 shadow-[0_0_8px_rgba(148,163,184,0.45)]";
  if (rank === 3) return "bg-amber-700/90 text-white shadow-[0_0_8px_rgba(180,83,9,0.45)]";
  return "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200";
}

function PtPodiumCard({ row, leaderPt }: { row: RankingRow; leaderPt: number }) {
  const gauge = percentOfLeader(row.pt, leaderPt);
  return (
    <div
      className={`${podiumCardShell(row.rank)} ${
        row.isSelf ? "ring-2 ring-inset ring-cyan-300/80 dark:ring-cyan-400/35" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold ${rankBadgeClass(row.rank)}`}
        >
          {row.rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-[15px] font-bold ${podiumNameClass(row.rank)}`}>
            {row.staffName}
            {row.isSelf ? (
              <span className="ml-2 text-[11px] font-medium text-cyan-700 dark:text-cyan-300">
                あなた
              </span>
            ) : null}
          </p>
          <p className={`mt-1 text-[1.75rem] leading-none ${ptValueClass()}`}>
            {formatPt(row.pt)}
            <span className="ml-1 text-[14px] font-bold">PT</span>
          </p>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
            {formatYen(row.salesAmount)}
          </p>
          <PtGauge percent={gauge} />
          <p className="mt-1 text-[11px] text-slate-500 dark:text-emerald-300/80">
            1位比 {gauge}%
          </p>
        </div>
      </div>
    </div>
  );
}

function PtListRow({ row, leaderPt }: { row: RankingRow; leaderPt: number }) {
  const gauge = percentOfLeader(row.pt, leaderPt);
  return (
    <div
      className={`rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm dark:border-emerald-500/15 dark:bg-slate-900/50 ${
        row.isSelf ? "ring-2 ring-inset ring-cyan-300/70 dark:ring-cyan-400/30" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${rankBadgeClass(row.rank)}`}
        >
          {row.rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-slate-800 dark:text-white">
            {row.staffName}
            {row.isSelf ? (
              <span className="ml-2 text-[11px] font-medium text-cyan-700 dark:text-cyan-300">
                あなた
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
            {formatYen(row.salesAmount)}
          </p>
          <PtGauge percent={gauge} />
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-[16px] ${ptValueClass()}`}>
            {formatPt(row.pt)}
            <span className="ml-0.5 text-[12px] font-bold">PT</span>
          </p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">1位比 {gauge}%</p>
        </div>
      </div>
    </div>
  );
}

function PtRankingSection({ rows }: { rows: RankingRow[] }) {
  if (rows.length === 0) {
    return (
      <LiffCard>
        <p className="px-4 py-6 text-center text-[13px] text-slate-500 dark:text-slate-400">
          対象期間のデータがありません
        </p>
      </LiffCard>
    );
  }
  const leaderPt = rows[0]?.pt ?? 0;
  const podium = rows.filter((r) => r.rank <= 3);
  const rest = rows.filter((r) => r.rank > 3);
  return (
    <div className="flex flex-col gap-3">
      {podium.length > 0 ? (
        <div className="flex flex-col gap-2">
          {podium.map((row) => (
            <PtPodiumCard key={`podium-${row.rank}-${row.staffName}`} row={row} leaderPt={leaderPt} />
          ))}
        </div>
      ) : null}
      {rest.length > 0 ? (
        <div className="flex flex-col gap-2">
          {rest.map((row) => (
            <PtListRow key={`${row.rank}-${row.staffName}`} row={row} leaderPt={leaderPt} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SalesRankingSection({ rows }: { rows: RankingRow[] }) {
  if (rows.length === 0) {
    return (
      <LiffCard>
        <p className="px-4 py-6 text-center text-[13px] text-slate-500 dark:text-slate-400">
          対象期間のデータがありません
        </p>
      </LiffCard>
    );
  }
  const sorted = [...rows].sort((a, b) => b.salesAmount - a.salesAmount);
  const leaderSales = sorted[0]?.salesAmount ?? 0;
  return (
    <div className="flex flex-col gap-2">
      {sorted.map((row, i) => {
        const displayRank = i + 1;
        const gauge = percentOfLeader(row.salesAmount, leaderSales);
        const isPodium = displayRank <= 3;
        const shell = isPodium
          ? podiumCardShell(displayRank)
          : "rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm dark:border-emerald-500/15 dark:bg-slate-900/50";
        return (
          <div
            key={`sales-${row.staffName}`}
            className={`${shell} ${
              row.isSelf ? "ring-2 ring-inset ring-cyan-300/70 dark:ring-cyan-400/30" : ""
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${rankBadgeClass(displayRank)}`}
              >
                {displayRank}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-[14px] font-semibold ${
                    isPodium ? podiumNameClass(displayRank) : "text-slate-800 dark:text-white"
                  }`}
                >
                  {row.staffName}
                  {row.isSelf ? (
                    <span className="ml-2 text-[11px] text-cyan-700 dark:text-cyan-300">あなた</span>
                  ) : null}
                </p>
                <p className={`text-[12px] ${ptValueClass()}`}>{formatPt(row.pt)} PT</p>
                <PtGauge percent={gauge} />
              </div>
              <p className="shrink-0 text-right text-[15px] font-bold text-slate-800 dark:text-white">
                {formatYen(row.salesAmount)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ApoPodiumCard({ row, leaderCount }: { row: ApoRankingRow; leaderCount: number }) {
  const gauge = percentOfLeader(row.apoCount, leaderCount);
  return (
    <div
      className={`${podiumCardShell(row.rank)} ${
        row.isSelf ? "ring-2 ring-inset ring-cyan-300/80 dark:ring-cyan-400/35" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold ${rankBadgeClass(row.rank)}`}
        >
          {row.rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-[15px] font-bold ${podiumNameClass(row.rank)}`}>
            {row.staffName}
            {row.isSelf ? (
              <span className="ml-2 text-[11px] text-cyan-700 dark:text-cyan-300">あなた</span>
            ) : null}
          </p>
          <PtGauge percent={gauge} />
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">1位比 {gauge}%</p>
        </div>
        <p className={`shrink-0 text-[1.5rem] ${ptValueClass()}`}>
          {formatCount(row.apoCount)}
          <span className="ml-0.5 text-[13px] font-bold">件</span>
        </p>
      </div>
    </div>
  );
}

function ApoListRow({ row, leaderCount }: { row: ApoRankingRow; leaderCount: number }) {
  const gauge = percentOfLeader(row.apoCount, leaderCount);
  return (
    <div
      className={`rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm dark:border-emerald-500/15 dark:bg-slate-900/50 ${
        row.isSelf ? "ring-2 ring-inset ring-cyan-300/70 dark:ring-cyan-400/30" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${rankBadgeClass(row.rank)}`}
        >
          {row.rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-slate-800 dark:text-white">
            {row.staffName}
            {row.isSelf ? (
              <span className="ml-2 text-[11px] text-cyan-700 dark:text-cyan-300">あなた</span>
            ) : null}
          </p>
          <PtGauge percent={gauge} />
        </div>
        <p className={`shrink-0 text-[15px] ${ptValueClass()}`}>{formatCount(row.apoCount)}件</p>
      </div>
    </div>
  );
}

function ApoRankingSection({ rows }: { rows: ApoRankingRow[] }) {
  if (rows.length === 0) {
    return (
      <LiffCard>
        <p className="px-4 py-6 text-center text-[13px] text-slate-500 dark:text-slate-400">
          対象期間のデータがありません
        </p>
      </LiffCard>
    );
  }
  const leaderCount = rows[0]?.apoCount ?? 0;
  const podium = rows.filter((r) => r.rank <= 3);
  const rest = rows.filter((r) => r.rank > 3);
  return (
    <div className="flex flex-col gap-3">
      {podium.map((row) => (
        <ApoPodiumCard key={`apo-p-${row.rank}`} row={row} leaderCount={leaderCount} />
      ))}
      {rest.map((row) => (
        <ApoListRow key={`apo-${row.rank}`} row={row} leaderCount={leaderCount} />
      ))}
    </div>
  );
}

type Props = {
  data: DashboardPayload;
  department: DashboardDepartment;
  onDepartmentChange: (d: DashboardDepartment) => void;
};

export function SalesDashboardCyberView({
  data,
  department,
  onDepartmentChange,
}: Props) {
  const personal = resolvePersonalKpi(data);
  const apoConfigured = data.apoEnabled;
  const apoReady = data.apoReady;

  const rankingTitle =
    department === "pt"
      ? "総合PTランキング"
      : department === "sales"
        ? "売上金額ランキング"
        : "アポ件数ランキング";

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-slate-500 dark:text-emerald-200/50">
        {data.periodLabel}（JST）· {data.periodHint}
      </p>

      <PersonalKpiHero personal={personal} periodLabel={data.periodLabel} />

      <section>
        <div className="relative mb-3">
          <nav
            className="flex gap-2 overflow-x-auto pb-2 pl-0.5 pr-10 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="ランキング部門"
          >
            {DEPARTMENT_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onDepartmentChange(tab.id)}
                className={tabClass(department === tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-slate-50 to-transparent dark:from-slate-950"
            aria-hidden
          />
        </div>

        <h2 className="mb-3 text-[15px] font-bold tracking-wide text-slate-800 dark:text-emerald-50">
          {rankingTitle}
        </h2>

        {department === "apo" && !apoConfigured ? (
          <LiffCard>
            <p className="px-4 py-6 text-center text-[13px] text-slate-500 dark:text-slate-400">
              アポ件数ランキングは未設定です（SALES_DASHBOARD_APO_APP_ID を設定してください）
            </p>
          </LiffCard>
        ) : department === "apo" && !apoReady ? (
          <LiffCard>
            <p className="px-4 py-6 text-center text-[13px] text-red-800 dark:text-red-300 whitespace-pre-wrap">
              {data.apoError ?? "アポ件数ランキングの集計に失敗しました"}
            </p>
          </LiffCard>
        ) : department === "apo" ? (
          <ApoRankingSection rows={data.apoRanking} />
        ) : department === "sales" ? (
          <SalesRankingSection rows={data.ranking} />
        ) : (
          <PtRankingSection rows={data.ranking} />
        )}
      </section>
    </div>
  );
}
