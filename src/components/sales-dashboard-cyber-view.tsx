"use client";

import { useState } from "react";

import { LiffCard } from "@/components/liff-chrome";
import { formatDisplayYmd } from "@/lib/format-display-ymd";
import { barRatio } from "@/lib/sales-dashboard-bar-ratio";

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
  /** 目標登録(月次)の PT 目標。未設定・取得不可は 0 */
  targetPt: number;
  /** 達成率(%)。targetPt <= 0 のときは 0 */
  achievementRate: number;
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

/** AP担当者・CL担当者を両方表示（未設定は省略） */
function formatApClAssignees(apPerson: string, clPerson: string): string {
  const ap = apPerson.normalize("NFKC").replace(/\s+/g, " ").trim();
  const cl = clPerson.normalize("NFKC").replace(/\s+/g, " ").trim();
  const parts: string[] = [];
  if (ap) parts.push(`AP担当者：${ap}`);
  if (cl) parts.push(`CL担当者：${cl}`);
  return parts.join(" / ");
}

/** 契約日：yyyy/mm/dd */
function formatContractDateLabel(dateYmd: string): string {
  const display = dateYmd.trim()
    ? formatDisplayYmd(dateYmd) || dateYmd.trim()
    : "";
  return display ? `契約日：${display}` : "契約日：—";
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

/**
 * 棒の色。**その行で棒が表している数値の文字色に合わせる。**
 *
 * 売上金額部門はカードに PT（緑）と売上（黒／白）が並ぶので、棒まで緑だと
 * どちらの棒か分からない。売上だけ色を変える。
 * 順位バッジ（琥珀・銀）とは競合させない。
 *
 * Tailwind は動的なクラス名を生成しないので、完成形の文字列を並べておく。
 */
const RANK_BAR_TONES = {
  emerald: "bg-emerald-500 dark:bg-emerald-400",
  sky: "bg-sky-500 dark:bg-sky-400",
  /** 総合PT の達成（100%以上）。順位バッジの琥珀より濃くして区別する */
  amber: "bg-amber-500 dark:bg-amber-400",
} as const;

type RankBarTone = keyof typeof RANK_BAR_TONES;

/**
 * 順位比較の横棒。1位を100%とした割合で伸ばす。
 *
 * 幅は算出値なので style で渡す。Tailwind は動的なクラス名を生成しない。
 * 数値は同じ行に出ているので、読み上げの対象からは外す。
 */
function RankBar({
  value,
  top,
  tone = "emerald",
}: {
  value: number;
  /** 1位の値。棒の基準（0 なら棒は伸びない） */
  top: number;
  tone?: RankBarTone;
}) {
  return (
    <div
      className="mt-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700/60"
      aria-hidden
    >
      <div
        className={`h-1.5 rounded-full transition-[width] duration-300 ${RANK_BAR_TONES[tone]}`}
        style={{ width: `${barRatio(value, top)}%` }}
      />
    </div>
  );
}

/** 達成とみなす下限（%）。棒と達成率の色をここで切り替える */
const PT_TARGET_ACHIEVED_RATE = 100;

function ptRateTone(rate: number): "emerald" | "amber" {
  return rate >= PT_TARGET_ACHIEVED_RATE ? "amber" : "emerald";
}

/** 棒の内側に置く達成率の文字色。塗りの色と対にする */
const PT_BAR_INSIDE_TEXT_TONES = {
  emerald: "text-white dark:text-emerald-950",
  amber: "text-white dark:text-amber-950",
} as const;

/** 棒の中・外に出す達成率。桁を詰めるため整数（149%） */
function formatAchievementRateCompact(rate: number): string {
  return `${Math.round(Number.isFinite(rate) ? rate : 0)}%`;
}

/**
 * 総合PTランキングの横棒。**長さは PT 順（1位を100%）。**
 *
 * 長さに達成率を使うと、目標が小さい人ほど棒が長くなり、PT の順位と棒の
 * 並びが食い違う。長さは PT で決め、目標と達成率はラベルの文字で伝える。
 *
 * ■ ラベルを2枚重ねる
 * 同じ文字列を塗りの上下に置き、上のコピーだけ clip-path で塗りの幅ぶんに
 * 切り出す。塗りに覆われた部分は明色、はみ出した部分は通常色で読めるので、
 * 棒が短い行でも全文が出る。「入るか外へ出すか」の閾値判定が要らなくなり、
 * 棒は常に全幅（＝行ごとの基準がそろう）。
 * 上のコピーは同じ文を繰り返すだけなので読み上げからは外す。
 *
 * 色は達成率で変える（100%以上 amber・未満と未設定 emerald）。
 */
function PtRankingBar({
  pt,
  topPt,
  target,
  rate,
}: {
  pt: number;
  /** 1位の PT。棒の基準（0 なら棒は伸びない） */
  topPt: number;
  target: number;
  rate: number;
}) {
  const ratio = barRatio(pt, topPt);
  const tone = ptRateTone(rate);
  // 目標が無い行は達成率そのものが無いので、括弧ごと出さない
  const label =
    target > 0
      ? `${formatPt(pt)} / ${formatPt(target)}（${formatAchievementRateCompact(rate)}）`
      : `${formatPt(pt)} / ${formatPt(target)}`;
  const labelClass =
    "absolute inset-0 flex items-center px-3 text-[11px] font-bold tabular-nums";

  return (
    <div className="relative mt-2 h-6 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700/60">
      {/* 塗り。left 基準で伸ばす（inset-0 と width は同時に効かない） */}
      <div
        className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ${RANK_BAR_TONES[tone]}`}
        style={{ width: `${ratio}%` }}
      />
      <span className={`${labelClass} text-slate-700 dark:text-slate-200`}>
        {label}
      </span>
      <span
        className={`${labelClass} ${PT_BAR_INSIDE_TEXT_TONES[tone]}`}
        style={{ clipPath: `inset(0 ${100 - ratio}% 0 0)` }}
        aria-hidden
      >
        {label}
      </span>
    </div>
  );
}

function rankBadgeClass(rank: number): string {
  if (rank === 1) return "bg-amber-400 text-amber-950 shadow-[0_0_10px_rgba(234,179,8,0.5)]";
  if (rank === 2) return "bg-slate-300 text-slate-800 dark:bg-slate-400 dark:text-slate-900 shadow-[0_0_8px_rgba(148,163,184,0.45)]";
  if (rank === 3) return "bg-amber-700/90 text-white shadow-[0_0_8px_rgba(180,83,9,0.45)]";
  return "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200";
}

function PtBreakdownPanel({ rows }: { rows: PtBreakdownRow[] }) {
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
        const contractDate = formatContractDateLabel(item.dateYmd);
        const assignees = formatApClAssignees(item.apPerson, item.clPerson);
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
            {assignees ? (
              <p className="mt-1 text-slate-500 dark:text-slate-400">{assignees}</p>
            ) : null}
            <p className="mt-0.5 text-slate-500 dark:text-slate-400">
              {contractDate}
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
  topPt,
  expanded,
  onToggle,
}: {
  row: RankingRow;
  breakdown: PtBreakdownRow[];
  /** 1位の PT。棒の基準（0 なら棒は伸びない） */
  topPt: number;
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
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
            {formatYen(row.salesAmount)}
            <span className="ml-2 text-[11px] text-slate-400 dark:text-slate-500">
              {expanded ? "▲ 明細を閉じる" : "▼ PT明細"}
            </span>
          </p>
        </div>
      </button>
      <PtRankingBar
        pt={row.pt}
        topPt={topPt}
        target={row.targetPt}
        rate={row.achievementRate}
      />
      {expanded ? (
        <PtBreakdownPanel rows={breakdown} />
      ) : null}
    </div>
  );
}

function PtListRow({
  row,
  breakdown,
  topPt,
  expanded,
  onToggle,
}: {
  row: RankingRow;
  breakdown: PtBreakdownRow[];
  /** 1位の PT。棒の基準（0 なら棒は伸びない） */
  topPt: number;
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
      </button>
      <PtRankingBar
        pt={row.pt}
        topPt={topPt}
        target={row.targetPt}
        rate={row.achievementRate}
      />
      {expanded ? (
        <PtBreakdownPanel rows={breakdown} />
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
  /** 棒の基準。rows はサーバ側で PT 降順なので先頭が1位 */
  const topPt = rows[0]?.pt ?? 0;
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
              topPt={topPt}
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
              topPt={topPt}
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
  /**
   * 棒の基準。**この部門だけ並べ替えが画面側**なので、rows[0]（PT順の1位）
   * ではなく並べ替えた後の先頭を見る
   */
  const topSales = sorted[0]?.salesAmount ?? 0;
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
            <RankBar value={row.salesAmount} top={topSales} tone="sky" />
          </div>
        );
      })}
    </div>
  );
}

function ApoPodiumCard({
  row,
  topCount,
}: {
  row: ApoRankingRow;
  /** 1位の件数。棒の基準（0 なら棒は伸びない） */
  topCount: number;
}) {
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
      <RankBar value={row.apoCount} top={topCount} />
    </div>
  );
}

function ApoListRow({
  row,
  topCount,
}: {
  row: ApoRankingRow;
  /** 1位の件数。棒の基準（0 なら棒は伸びない） */
  topCount: number;
}) {
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
      <RankBar value={row.apoCount} top={topCount} />
    </div>
  );
}

/**
 * アポ件数部門と AP天下賞で共用。
 *
 * 天下賞の対象件数はサーバ側で apoCount に載って届く
 * （sales-dashboard-apo-tenka-bundle.ts の buildTenkaRanking）。
 * 画面側に targetCount という項目は無いので、値の出し分けは要らない
 */
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
  /** 棒の基準。rows はサーバ側で件数の降順なので先頭が1位 */
  const topCount = rows[0]?.apoCount ?? 0;
  return (
    <div className="flex flex-col gap-3">
      {podium.map((row) => (
        <ApoPodiumCard key={`apo-p-${row.rank}`} row={row} topCount={topCount} />
      ))}
      {rest.map((row) => (
        <ApoListRow key={`apo-${row.rank}`} row={row} topCount={topCount} />
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
