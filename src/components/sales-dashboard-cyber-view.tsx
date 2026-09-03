"use client";

import { useEffect, useState } from "react";

import { LiffCard } from "@/components/liff-chrome";
import { formatDisplayYmd } from "@/lib/format-display-ymd";
import { barRatio } from "@/lib/sales-dashboard-bar-ratio";

export type DashboardPeriod = "current" | "previous";
export type DashboardDepartment = "pt" | "apo";

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
  /** スタッフ名簿の勤務場所（所属支社）。引けなければ空文字 */
  branch: string;
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

/**
 * API の応答そのまま。
 *
 * ⚠ **画面で使わない項目が残っている。**「売上金額部門」と「AP天下賞」の
 *   タブを消したため、`tenkaReady` / `tenkaError` / `tenkaKpi` /
 *   `tenkaRanking` と、行の `salesAmount`・`kpi` は描画していない。
 *
 *   サーバ側を削っていないのは負荷が下がらないから。天下賞はアポ件数と
 *   同じ fields / records から集計しており、売上もPT集計と同じレコードを
 *   読んでいる。止めても @pocket への問い合わせは減らず、戻すときの手間
 *   だけが増える。型に残してあるので、タブを戻すなら描画を足すだけでよい。
 */
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
  { id: "apo", label: "アポ件数部門" },
];

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

/**
 * 台座カードの枠と背景。**全順位で同じ色**（1〜3位の琥珀・銀・銅は廃止）。
 * 順位バッジ（RANK_BADGE_CLASS）と同じ方針。全部門で共有している。
 *
 * 大きさ（角丸・余白）は従来どおり。色分けだけをやめた。
 */
const PODIUM_CARD_SHELL =
  "relative rounded-[1.35rem] border px-4 py-4 border-slate-100 bg-white dark:border-slate-700/60 dark:bg-transparent";

/** 台座カードの氏名。順位による色分けは廃止 */
const PODIUM_NAME_CLASS = "text-slate-800 dark:text-white";

function ptValueClass(): string {
  return "font-bold text-emerald-600 dark:font-black dark:text-emerald-400 dark:drop-shadow-[0_0_16px_rgba(52,211,153,0.45)]";
}

/**
 * 順位比較の横棒（アポ件数部門）。1位を100%とした割合で伸ばす。
 *
 * 以前は色を差し替えられるようにしていたが、切り替えていたのは売上金額部門
 * だけで、その部門を消したため色は緑の1色になった。
 * 幅は算出値なので style で渡す。Tailwind は動的なクラス名を生成しない。
 * 数値は同じ行に出ているので、読み上げの対象からは外す。
 */
function RankBar({
  value,
  top,
}: {
  value: number;
  /** 1位の値。棒の基準（0 なら棒は伸びない） */
  top: number;
}) {
  return (
    <div
      className="mt-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700/60"
      aria-hidden
    >
      <div
        className="h-1.5 rounded-full bg-emerald-500 transition-[width] duration-300 dark:bg-emerald-400"
        style={{ width: `${barRatio(value, top)}%` }}
      />
    </div>
  );
}

/** 達成とみなす下限（%）。棒の色をここで切り替える */
const PT_TARGET_ACHIEVED_RATE = 100;

/**
 * 総合PTの棒の色。**この2色は総合PT専用**で、アポ件数部門の RankBar
 * （緑の1色）とは別に持つ。
 *
 * 任意値クラスは完成形をそのまま書く（Tailwind は動的なクラス名を作らない）。
 *
 * ⚠ 赤 #E60012 に白文字はコントラスト比 約4.8:1。AA の 4.5:1 は満たすが、
 *   11px では下限に近い。実機で読みにくければ #C8000F（白と約6.1:1）まで
 *   暗くする余地がある。変えるのはこの1行で足りる。
 */
const PT_BAR_TONES = {
  navy: "bg-[#1F4E9C] dark:bg-[#4C86D8]",
  red: "bg-[#E60012] dark:bg-[#FF3B45]",
} as const;

/** 塗りに重なるラベル。赤・紺とも濃色なので、明暗どちらでも白で通す */
const PT_BAR_LABEL_ON_FILL = "text-white";

function isPtTargetAchieved(rate: number): boolean {
  return rate >= PT_TARGET_ACHIEVED_RATE;
}

function ptBarTone(rate: number): "navy" | "red" {
  return isPtTargetAchieved(rate) ? "red" : "navy";
}

/**
 * 所属支社。氏名の右に小さく添える。
 *
 * 氏名側が truncate で先に縮み、支社は flex-none で幅を保つ。
 * 支社名そのものが長いときだけ、45% を上限に省略記号で切る。
 * 空文字（名簿から引けない）のときは何も出さない — 「未設定」とは書かない。
 */
const PT_BRANCH_TEXT_CLASS =
  "text-[11px] font-normal text-slate-500 dark:text-slate-400";

function PtBranchLabel({ branch }: { branch: string }) {
  if (!branch.trim()) return null;
  return (
    <span className={`max-w-[45%] flex-none truncate ${PT_BRANCH_TEXT_CLASS}`}>
      {branch.trim()}
    </span>
  );
}

/**
 * 顔写真の枠。台座カード（上位3位）にだけ出す縦長の四角。
 *
 * **写真と頭文字の四角で必ず同じ寸法を使う。**寸法が違うと、写真の登録の
 * 有無で行の高さが変わる。
 */
const PT_AVATAR_BOX = "h-[66px] w-[52px] shrink-0 rounded-md";

/** 写真が無い・取れないときの四角。取得中もこれを出す（場所を空けない） */
function PtStaffAvatarFallback({ name }: { name: string }) {
  return (
    <div
      role="img"
      aria-label={name ? `${name} の写真` : "担当者の写真"}
      className={`${PT_AVATAR_BOX} flex items-center justify-center bg-slate-100 text-[20px] font-bold text-slate-500 ring-1 ring-slate-200/80 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600`}
    >
      {name ? name.slice(0, 1) : "—"}
    </div>
  );
}

/**
 * 上位3位の顔アイコン。名簿の顔写真、無ければ頭文字の丸。
 *
 * `<img src>` に認証ヘッダは付けられないので、fetch して blob URL にする
 * （工事カレンダーの添付画像と同じ方式）。作った blob URL は unmount と
 * 再取得のたびに revoke する。放っておくとメモリが増え続ける。
 *
 * **失敗しても何も言わない。** 写真が未登録の人のほうが多く、404 は異常では
 * ない。取得中も頭文字を出しておき、届いたら差し替える（行の高さが動かない）。
 */
function PtStaffAvatar({
  staffName,
  idToken,
}: {
  staffName: string;
  idToken?: string | null;
}) {
  const name = staffName.trim();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!name || !idToken) {
      setPhotoUrl(null);
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(
          `/api/staff/photo?${new URLSearchParams({ staffName: name })}`,
          {
            headers: { Authorization: `Bearer ${idToken}` },
            signal: controller.signal,
          },
        );
        // 404（写真未登録）もここに落ちる。頭文字のままでよい
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPhotoUrl(objectUrl);
      } catch {
        /* 中断・通信失敗とも頭文字の丸のままにする */
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [name, idToken]);

  if (!photoUrl) return <PtStaffAvatarFallback name={name} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- blob URL は next/image で扱えない
    <img
      src={photoUrl}
      alt={name ? `${name} の写真` : "担当者の写真"}
      className={`${PT_AVATAR_BOX} object-cover ring-1 ring-slate-200/80 dark:ring-slate-600`}
    />
  );
}

/**
 * 目標達成の印。表に花丸・裏にバラを持つコインが回り続ける。
 *
 * 2枚を重ねて片方を180度回し、backface-visibility で裏返った面を隠す。
 * 動きの定義は globals.css の .pt-coin（preserve-3d と幅・高さが必須）。
 *
 * ラベルは**この親1箇所だけ**に置く。子の絵文字にも付けると同じ内容が
 * 3回読み上げられる。
 * 回転中に 1.35 倍へ膨らむので、余白は margin ではなく親の gap で確保する
 * （margin だと拡縮のたびに行の幅が動きうる）。
 */
function PtAchievedCoin() {
  return (
    <span className="pt-coin shrink-0 self-center" role="img" aria-label="目標達成">
      <span className="pt-coin-face">💮</span>
      <span className="pt-coin-face pt-coin-back">🌹</span>
    </span>
  );
}

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
 * 色は達成率で変える（100%以上 赤・未満と未設定 紺）。
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
  const tone = ptBarTone(rate);
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
        className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ${PT_BAR_TONES[tone]}`}
        style={{ width: `${ratio}%` }}
      />
      <span className={`${labelClass} text-slate-700 dark:text-slate-200`}>
        {label}
      </span>
      <span
        className={`${labelClass} ${PT_BAR_LABEL_ON_FILL}`}
        style={{ clipPath: `inset(0 ${100 - ratio}% 0 0)` }}
        aria-hidden
      >
        {label}
      </span>
    </div>
  );
}

/**
 * 順位バッジ。**全順位で同じ色**（1〜3位の琥珀・銀・銅は廃止）。
 * 全部門（総合PT・売上・アポ・天下賞）で共有している。
 *
 * 総合PTだけ数字を紺にしたことがあるが、当時の3位（濃い琥珀）の上で
 * 1.6:1 まで落ちて読めなくなったため取りやめた。地色を変えるときは、
 * 数字の色とセットでコントラストを確かめること。
 */
const RANK_BADGE_CLASS =
  "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200";

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
  idToken,
  expanded,
  onToggle,
}: {
  row: RankingRow;
  breakdown: PtBreakdownRow[];
  /** 1位の PT。棒の基準（0 なら棒は伸びない） */
  topPt: number;
  /** 顔写真の取得に使う。無ければ頭文字のまま */
  idToken?: string | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`${PODIUM_CARD_SHELL} ${
        row.isSelf ? "ring-2 ring-inset ring-cyan-300/80 dark:ring-cyan-400/35" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 text-left"
      >
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold ${RANK_BADGE_CLASS}`}
        >
          {row.rank}
        </span>
        <PtStaffAvatar staffName={row.staffName} idToken={idToken} />
        <div className="min-w-0 flex-1">
          {/* 1行目: 氏名 ＋ 花丸（写真が基準点になるので、印は氏名の右） */}
          <div className="flex min-w-0 items-center gap-1.5">
            <p
              className={`min-w-0 truncate text-[15px] font-bold ${PODIUM_NAME_CLASS}`}
            >
              {row.staffName}
              {row.isSelf ? (
                <span className="ml-2 text-[11px] font-medium text-cyan-700 dark:text-cyan-300">
                  あなた
                </span>
              ) : null}
            </p>
            {isPtTargetAchieved(row.achievementRate) ? <PtAchievedCoin /> : null}
          </div>
          {/* 2行目: 支社名。氏名と1行に並べていた頃の窮屈さを解消する */}
          {row.branch.trim() ? (
            <p className={`mt-0.5 truncate ${PT_BRANCH_TEXT_CLASS}`}>
              {row.branch.trim()}
            </p>
          ) : null}
          <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
            {expanded ? "▲ 明細を閉じる" : "▼ PT明細"}
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
          className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${RANK_BADGE_CLASS}`}
        >
          {row.rank}
        </span>
        {isPtTargetAchieved(row.achievementRate) ? (
          <PtAchievedCoin />
        ) : (
          <span className="pt-coin-slot shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <p className="min-w-0 truncate text-[14px] font-semibold text-slate-800 dark:text-white">
              {row.staffName}
              {row.isSelf ? (
                <span className="ml-2 text-[11px] font-medium text-cyan-700 dark:text-cyan-300">
                  あなた
                </span>
              ) : null}
            </p>
            <PtBranchLabel branch={row.branch} />
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
            {expanded ? "▲ 明細を閉じる" : "▼ PT明細"}
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
  idToken,
}: {
  rows: RankingRow[];
  breakdownByStaff: Record<string, PtBreakdownRow[]>;
  /** 上位3位の顔写真の取得に使う */
  idToken?: string | null;
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
              idToken={idToken}
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
      className={`${PODIUM_CARD_SHELL} ${
        row.isSelf ? "ring-2 ring-inset ring-cyan-300/80 dark:ring-cyan-400/35" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold ${RANK_BADGE_CLASS}`}
        >
          {row.rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-[15px] font-bold ${PODIUM_NAME_CLASS}`}>
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
          className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${RANK_BADGE_CLASS}`}
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
  /** 総合PT上位3位の顔写真取得に使う（/api/staff/photo の認証） */
  idToken?: string | null;
};

export function SalesDashboardCyberView({
  data,
  department,
  onDepartmentChange,
  idToken,
}: Props) {
  const apoConfigured = data.apoEnabled;
  const apoReady = data.apoReady;

  const rankingTitle =
    department === "pt" ? "総合PTランキング" : "アポ件数ランキング";

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
        ) : (
          <PtRankingSection
            rows={data.ranking}
            breakdownByStaff={data.ptBreakdownByStaff ?? {}}
            idToken={idToken}
          />
        )}
      </section>
    </div>
  );
}
