"use client";

import { LiffCard } from "@/components/liff-chrome";
import {
  SalesProgressHeadline,
  SalesProgressRow,
} from "@/components/sales-progress-bar";
import {
  sortSalesProgressStaffRows,
  type SalesProgressMetricKey,
  type SalesProgressMetrics,
} from "@/lib/sales-progress-aggregate";

/**
 * 「全体の進捗」と「支社別」。
 *
 * ■ どこから使うか
 * いまは営業進捗（/sales-progress）から。段階3で営業ランキング
 * （/sales-dashboard）へ移す。両方から使うので **SalesProgressPayload には
 * 依存させない**。段階1で core が返す progress / annualProgress と同じ形を
 * props で受け取るだけにしてある（構造が同じなのでそのまま渡せる）。
 *
 * ■ 折りたたみは持たない
 * 以前は「セクション全体」と「支社ごとの内訳」の2段が閉じていた。支社の下の
 * 個人は常に出す方針になったので、開閉の状態も aria-expanded も記号も持たない。
 *
 * ■ 配色は営業ランキング（cyber-view）に合わせる
 * 移設先で浮かないよう、寄せるのは**こちら側だけ**。cyber-view には sky が
 * 無いので使わず、緑（emerald）と灰（slate）、本人の水色（cyan）で通す。
 * 棒そのものは sales-progress-bar.tsx をそのまま使うため、色は tone の
 * 選び方で寄せている（company=sky は使わない）。
 */

export type SalesProgressMemberRow = {
  staffName: string;
  isSelf: boolean;
  metrics: SalesProgressMetrics;
};

export type SalesProgressBranchRow = {
  label: string;
  memberCount: number;
  metrics: SalesProgressMetrics;
  members: SalesProgressMemberRow[];
};

/** 段階1の SalesDashboardProgressPayload と同じ形 */
export type SalesProgressSectionData = {
  company: SalesProgressMetrics;
  branches: SalesProgressBranchRow[];
  targetsAvailable: boolean;
};

/** 小見出し。cyber-view の期間行と同じ調子 */
const SECTION_HEADING_CLASS =
  "text-[12px] font-bold text-slate-500 dark:text-emerald-200/50";

/** 補足文。cyber-view の空状態と同じ */
const NOTE_CLASS = "text-[11px] leading-relaxed text-slate-500 dark:text-slate-400";

/** 支社1件の枠。cyber-view の ApoListRow と同じ */
const BRANCH_CARD_CLASS =
  "rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm dark:border-emerald-500/15 dark:bg-slate-900/50";

/** 本人の行。cyber-view と同じ水色のリング */
const SELF_RING_CLASS =
  "rounded-lg px-2 ring-2 ring-inset ring-cyan-300/70 dark:ring-cyan-400/30";

export function salesProgressMetricLabel(
  metric: SalesProgressMetricKey,
): string {
  return metric === "apo" ? "アポ" : "PT";
}

export function salesProgressMetricUnit(
  metric: SalesProgressMetricKey,
): string | undefined {
  return metric === "apo" ? "件" : undefined;
}

export function SalesProgressOverall({
  company,
  metric,
  targetsAvailable,
  periodLabel,
}: {
  company: SalesProgressMetrics;
  /** 部門タブ（総合PT／アポ件数）に連動する */
  metric: SalesProgressMetricKey;
  /** 対象期間の目標が1件も無い */
  targetsAvailable: boolean;
  /** 「2026年9月」「2026年度（年間）」など。未登録の案内文で使う */
  periodLabel: string;
}) {
  const shown = company[metric];
  return (
    <LiffCard>
      <div className="px-4 py-3">
        <h2 className={SECTION_HEADING_CLASS}>全体の進捗</h2>
        <SalesProgressHeadline
          label={salesProgressMetricLabel(metric)}
          metric={shown}
          unit={salesProgressMetricUnit(metric)}
          tone="self"
          targetKnown={shown.target > 0}
        />
        {!targetsAvailable ? (
          <p role="status" aria-live="polite" className={`mt-1 ${NOTE_CLASS}`}>
            {periodLabel}の目標が登録されていません。達成率は「—」になります。
          </p>
        ) : null}
      </div>
    </LiffCard>
  );
}

export function SalesProgressBranches({
  branches,
  metric,
  otherLabel,
  heading,
}: {
  branches: SalesProgressBranchRow[];
  metric: SalesProgressMetricKey;
  /** 寄せ先の見出し（既定「その他」）。案内文で使う */
  otherLabel: string;
  /**
   * セクションの見出し。**省略時は「支社別（PT）」「支社別（アポ）」。**
   *
   * 支社別タブのように「支社別を見ている」ことが文脈から明らかな場所では、
   * 「総合PT」「アポ件数」だけを渡して重ねない。営業進捗の画面は省略して
   * 呼ぶので、そちらの見出しは変わらない。
   */
  heading?: string;
}) {
  const unit = salesProgressMetricUnit(metric);

  return (
    <section className="flex flex-col gap-2">
      <h2 className={SECTION_HEADING_CLASS}>
        {heading ?? `支社別（${salesProgressMetricLabel(metric)}）`}
      </h2>

      {branches.map((branch) => {
        /**
         * 選んでいる指標の実績順に並べ替える。並び順は応答に持たせないので、
         * 部門を切り替えても取り直しは起きない。
         * 支社5件×十数名なので毎描画で回して問題ない
         */
        const members = sortSalesProgressStaffRows(branch.members, metric);
        return (
          <div key={branch.label} className={BRANCH_CARD_CLASS}>
            <SalesProgressRow
              label={branch.label}
              sub={`${branch.memberCount}名`}
              metric={branch.metrics[metric]}
              unit={unit}
              tone="self"
            />

            {members.length === 0 ? (
              <p className={`py-2 ${NOTE_CLASS}`}>この支社の担当者はいません</p>
            ) : (
              <div className="mt-1 divide-y divide-slate-100 border-t border-slate-100 pt-1 dark:divide-slate-700/60 dark:border-slate-700/60">
                {members.map((member) => (
                  <div
                    key={member.staffName}
                    className={member.isSelf ? SELF_RING_CLASS : undefined}
                  >
                    <SalesProgressRow
                      label={member.staffName}
                      sub={member.isSelf ? "あなた" : undefined}
                      metric={member.metrics[metric]}
                      unit={unit}
                      tone="branch"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <p className={NOTE_CLASS}>
        支社が未設定の方と、上記以外の支社の方は「{otherLabel}
        」に含めています。合計は全社の数字と一致します。
      </p>
    </section>
  );
}
