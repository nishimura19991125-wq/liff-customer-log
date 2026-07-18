"use client";

import { useState } from "react";

import { LiffCard } from "@/components/liff-chrome";
import { formatDisplayYmd } from "@/lib/format-display-ymd";

export type DashboardPeriod = "current" | "previous";
export type DashboardDepartment = "pt" | "sales" | "apo" | "tenka";

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

export type PtBreakdownRow = {
  customerName: string;
  apPerson: string;
  clPerson: string;
  salesperson: string;
  pt: number;
  sales: number;
  dateYmd: string;
};

export type DashboardPayload = {
  staffName: string;
  period: DashboardPeriod;
  periodLabel: string;
  periodHint: string;
  kpi: DashboardKpi;
  ranking: RankingRow[];
  /** 正規化担当者名 → PT 明細（全員閲覧可） */
  ptBreakdownByStaff?: Record<string, PtBreakdownRow[]>;
  apoEnabled: boolean;
  apoReady: boolean;
  apoError: string | null;
  apoKpi: { totalApoCount: number } | null;
  apoRanking: ApoRankingRow[];
  tenkaReady: boolean;
  tenkaError: string | null;
  tenkaKpi: { totalTargetCount: number } | null;
  tenkaRanking: ApoRankingRow[];
};

const DEPARTMENT_TABS: Array<{ id: DashboardDepartment; label: string }> = [
  { id: "pt", label: "総合PTランキング" },
  { id: "sales", label: "売上金額部門" },
  { id: "apo", label: "アポ件数部門" },
  { id: "tenka", label: "AP天下賞" },
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

function tabClass(active: boolean): string {
  return `shrink-0 rounded-2xl px-4 py-2.5 text-[14px] transition-all duration-300 active:scale-[0.98] ${
    active
      ? "cyber-tab-active"
      : "bg-slate-100 font-semibold text-slate-600 dark:bg-slate-800/80 dark:text-slate-400 dark:border dark:border-slate-700/60"
  }`;
}

type PersonalKpi = {
  /** 総合PT（売上PTのみ。アポ件数は加算しない） */
  totalPt: number;
  salesAmount: number;
  apoCount: number;
  contractCount: number;
  /** 本人のPT対象レコード（お客様名・PT） */
  breakdown: PtBreakdownRow[];
  /** 本人担当者名（AP/CL 突合の基準） */
  selfStaffName: string;
};

function normStaffDisplayName(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * お客様情報の AP/CL 表示用。
 * - 本人以外がいる → その名前のみ
 * - AP・CL とも本人 → 「APCL担当者」
 * - それ以外（未設定など）→ 空
 */
function otherAssigneeNames(
  apPerson: string,
  clPerson: string,
  selfStaffName: string,
): string {
  const self = normStaffDisplayName(selfStaffName);
  if (!self) return "";

  const ap = normStaffDisplayName(apPerson);
  const cl = normStaffDisplayName(clPerson);
  const apIsSelf = Boolean(ap && ap === self);
  const clIsSelf = Boolean(cl && cl === self);
  const apIsOther = Boolean(ap && ap !== self);
  const clIsOther = Boolean(cl && cl !== self);

  if (apIsOther) return ap;
  if (clIsOther) return cl;
  if (apIsSelf && clIsSelf) return "APCL担当者";
  return "";
}

function resolvePersonalKpi(data: DashboardPayload): PersonalKpi {
  const self = data.ranking.find((r) => r.isSelf);
  const selfApo = data.apoRanking.find((r) => r.isSelf);
  const salesPt = self?.pt ?? 0;
  const staffKey = self?.staffName?.trim() || "";
  const breakdown =
    staffKey && data.ptBreakdownByStaff
      ? (data.ptBreakdownByStaff[staffKey] ?? [])
      : [];
  return {
    totalPt: salesPt,
    salesAmount: self?.salesAmount ?? 0,
    apoCount: selfApo?.apoCount ?? 0,
    contractCount: self?.contractCount ?? 0,
    breakdown,
    selfStaffName: staffKey,
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

      <div className="relative mt-4 text-left">
        {personal.breakdown.length === 0 ? (
          <p className="rounded-lg bg-slate-50/90 px-3 py-2.5 text-center text-[12px] text-slate-500 dark:bg-slate-950/40 dark:text-slate-400">
            対象期間のPTレコードがありません
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {personal.breakdown.map((item, i) => {
              const other = otherAssigneeNames(
                item.apPerson,
                item.clPerson,
                personal.selfStaffName,
              );
              return (
                <li
                  key={`self-pt-${i}-${item.dateYmd}-${item.pt}-${item.customerName}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-50/90 px-3 py-2 text-[13px] dark:bg-slate-950/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">
                      {item.customerName.trim() || "（お客様名なし）"}
                    </p>
                    {other ? (
                      <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {other}
                      </p>
                    ) : null}
                  </div>
                  <span className={`shrink-0 ${ptValueClass()}`}>
                    {formatPt(item.pt)}
                    <span className="ml-0.5 text-[11px] font-bold">PT</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

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

function PtBreakdownPanel({
  rows,
  selfStaffName,
}: {
  rows: PtBreakdownRow[];
  selfStaffName: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-1 py-2 text-[12px] text-slate-500 dark:text-slate-400">
        対象期間のPT明細がありません
      </p>
    );
  }
  return (
    <ul className="mt-1 flex flex-col gap-2 border-t border-slate-200/80 pt-3 dark:border-slate-700/60">
      {rows.map((item, i) => {
        const dateLabel = item.dateYmd
          ? formatDisplayYmd(item.dateYmd) || item.dateYmd
          : "—";
        const other = otherAssigneeNames(
          item.apPerson,
          item.clPerson,
          selfStaffName,
        );
        return (
          <li
            key={`pt-bd-${i}-${item.dateYmd}-${item.pt}-${item.customerName}`}
            className="rounded-lg bg-slate-50/90 px-3 py-2.5 text-[12px] dark:bg-slate-950/50"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 font-semibold text-slate-800 dark:text-slate-100">
                {item.customerName.trim() || "（お客様名なし）"}
              </p>
              <p className={`shrink-0 ${ptValueClass()}`}>
                {formatPt(item.pt)}
                <span className="ml-0.5 text-[11px] font-bold">PT</span>
              </p>
            </div>
            {other ? (
              <p className="mt-1 text-slate-500 dark:text-slate-400">{other}</p>
            ) : null}
            <p className="mt-0.5 text-slate-500 dark:text-slate-400">
              {dateLabel}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function PtPodiumCard({
  row,
  breakdown,
  expanded,
  onToggle,
}: {
  row: RankingRow;
  breakdown: PtBreakdownRow[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`${podiumCardShell(row.rank)} ${
        row.isSelf ? "ring-2 ring-inset ring-cyan-300/80 dark:ring-cyan-400/35" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 text-left"
      >
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
            <span className="ml-2 text-[11px] text-slate-400 dark:text-slate-500">
              {expanded ? "▲ 明細を閉じる" : "▼ PT明細"}
            </span>
          </p>
        </div>
      </button>
      {expanded ? (
        <PtBreakdownPanel rows={breakdown} selfStaffName={row.staffName} />
      ) : null}
    </div>
  );
}

function PtListRow({
  row,
  breakdown,
  expanded,
  onToggle,
}: {
  row: RankingRow;
  breakdown: PtBreakdownRow[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm dark:border-emerald-500/15 dark:bg-slate-900/50 ${
        row.isSelf ? "ring-2 ring-inset ring-cyan-300/70 dark:ring-cyan-400/30" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 text-left"
      >
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
            <span className="ml-2 text-[11px] text-slate-400 dark:text-slate-500">
              {expanded ? "▲ 明細を閉じる" : "▼ PT明細"}
            </span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-[16px] ${ptValueClass()}`}>
            {formatPt(row.pt)}
            <span className="ml-0.5 text-[12px] font-bold">PT</span>
          </p>
        </div>
      </button>
      {expanded ? (
        <PtBreakdownPanel rows={breakdown} selfStaffName={row.staffName} />
      ) : null}
    </div>
  );
}

function PtRankingSection({
  rows,
  breakdownByStaff,
}: {
  rows: RankingRow[];
  breakdownByStaff: Record<string, PtBreakdownRow[]>;
}) {
  const [expandedName, setExpandedName] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <LiffCard>
        <p className="px-4 py-6 text-center text-[13px] text-slate-500 dark:text-slate-400">
          対象期間のデータがありません
        </p>
      </LiffCard>
    );
  }
  const podium = rows.filter((r) => r.rank <= 3);
  const rest = rows.filter((r) => r.rank > 3);

  const toggle = (staffName: string) => {
    setExpandedName((cur) => (cur === staffName ? null : staffName));
  };

  return (
    <div className="flex flex-col gap-3">
      {podium.length > 0 ? (
        <div className="flex flex-col gap-2">
          {podium.map((row) => (
            <PtPodiumCard
              key={`podium-${row.rank}-${row.staffName}`}
              row={row}
              breakdown={breakdownByStaff[row.staffName] ?? []}
              expanded={expandedName === row.staffName}
              onToggle={() => toggle(row.staffName)}
            />
          ))}
        </div>
      ) : null}
      {rest.length > 0 ? (
        <div className="flex flex-col gap-2">
          {rest.map((row) => (
            <PtListRow
              key={`${row.rank}-${row.staffName}`}
              row={row}
              breakdown={breakdownByStaff[row.staffName] ?? []}
              expanded={expandedName === row.staffName}
              onToggle={() => toggle(row.staffName)}
            />
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
  return (
    <div className="flex flex-col gap-2">
      {sorted.map((row, i) => {
        const displayRank = i + 1;
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

function ApoPodiumCard({ row }: { row: ApoRankingRow }) {
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
        </div>
        <p className={`shrink-0 text-[1.5rem] ${ptValueClass()}`}>
          {formatCount(row.apoCount)}
          <span className="ml-0.5 text-[13px] font-bold">件</span>
        </p>
      </div>
    </div>
  );
}

function ApoListRow({ row }: { row: ApoRankingRow }) {
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
  const podium = rows.filter((r) => r.rank <= 3);
  const rest = rows.filter((r) => r.rank > 3);
  return (
    <div className="flex flex-col gap-3">
      {podium.map((row) => (
        <ApoPodiumCard key={`apo-p-${row.rank}`} row={row} />
      ))}
      {rest.map((row) => (
        <ApoListRow key={`apo-${row.rank}`} row={row} />
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

  const tenkaConfigured = data.apoEnabled;
  const tenkaReady = data.tenkaReady;

  const rankingTitle =
    department === "pt"
      ? "総合PTランキング"
      : department === "sales"
        ? "売上金額ランキング"
        : department === "apo"
          ? "アポ件数ランキング"
          : "AP天下賞ランキング";

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
        ) : department === "tenka" && !tenkaConfigured ? (
          <LiffCard>
            <p className="px-4 py-6 text-center text-[13px] text-slate-500 dark:text-slate-400">
              AP天下賞ランキングは未設定です（SALES_DASHBOARD_APO_APP_ID を設定してください）
            </p>
          </LiffCard>
        ) : department === "tenka" && !tenkaReady ? (
          <LiffCard>
            <p className="px-4 py-6 text-center text-[13px] text-red-800 dark:text-red-300 whitespace-pre-wrap">
              {data.tenkaError ?? "AP天下賞ランキングの集計に失敗しました"}
            </p>
          </LiffCard>
        ) : department === "tenka" ? (
          <ApoRankingSection rows={data.tenkaRanking} />
        ) : department === "sales" ? (
          <SalesRankingSection rows={data.ranking} />
        ) : (
          <PtRankingSection
            rows={data.ranking}
            breakdownByStaff={data.ptBreakdownByStaff ?? {}}
          />
        )}
      </section>
    </div>
  );
}
