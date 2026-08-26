"use client";

import Link from "next/link";

import { LiffCard } from "@/components/liff-chrome";
import { formatCustomerNameForDisplay } from "@/lib/customer-name-display";
import {
  formatApoListScheduledDateTime,
  groupApoListRowsByDate,
  hasApoListGiftCoupon,
} from "@/lib/apo-list-display";
import type { ApoListRow } from "@/lib/apo-list-types";

type Props = {
  rows: ApoListRow[];
};

/**
 * バッジ。市区郡・アポ種別は商談予定カード
 * （meeting-schedule-item-card.tsx）と同じ配色・形にそろえる。
 * 見積ステータスも同じ流儀でバッジにする。
 */
const cityBadgeClass =
  "rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200";
const apoTypeBadgeClass =
  "rounded-md bg-amber-100 px-2 py-0.5 text-[12px] font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200";
const estimateStatusBadgeClass =
  "rounded-md bg-slate-100 px-2 py-0.5 text-[12px] text-slate-600 dark:bg-slate-800 dark:text-slate-300";
/**
 * ギフト券。形は他と同じで色だけ分ける。
 * 「有」のときにだけ出る印なので、灰色が並ぶ中で見分けが付くようにする
 */
const giftCouponBadgeClass =
  "rounded-md bg-emerald-100 px-2 py-0.5 text-[12px] font-medium text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200";

/** 1件分。お客様名 → バッジ3種 → 商談・資料送付予定日時 */
function ApoListRowCard({ row }: { row: ApoListRow }) {
  return (
    <LiffCard>
      {/* カード全体を詳細への導線にする */}
      <Link
        href={`/apo-list/${encodeURIComponent(row.recordId)}`}
        className="block px-4 py-4 active:opacity-70"
        aria-label={`${row.customerName || "名称未設定"} の詳細`}
      >
        <p className="text-[16px] font-bold leading-snug text-slate-900 dark:text-white">
          {/* 表示だけ整える。@pocket の値は変更しない */}
          {formatCustomerNameForDisplay(row.customerName) || "（名称未設定）"}
        </p>

        {/* flex-wrap で幅の狭い端末でも折り返す */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {row.city ? <span className={cityBadgeClass}>{row.city}</span> : null}
          {row.apoTypeLabel ? (
            <span className={apoTypeBadgeClass}>{row.apoTypeLabel}</span>
          ) : null}
          {row.estimateStatus ? (
            <span className={estimateStatusBadgeClass}>{row.estimateStatus}</span>
          ) : null}
          {/* 末尾。「有」のときだけ出す（判定は src/lib 側） */}
          {hasApoListGiftCoupon(row) ? (
            <span className={giftCouponBadgeClass}>ギフト券</span>
          ) : null}
        </div>

        <p className="mt-2 text-[13px] text-slate-600 dark:text-slate-400">
          商談・資料送付予定日時: {formatApoListScheduledDateTime(row)}
        </p>
      </Link>
    </LiffCard>
  );
}

export function ApoListRows({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <LiffCard>
        <p className="px-4 py-8 text-center text-[14px] text-slate-600 dark:text-slate-300">
          該当するアポ情報はありません
        </p>
      </LiffCard>
    );
  }

  // 絞り込み後の行を渡すこと。空のグループは作られない
  const groups = groupApoListRowsByDate(rows);

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.ymd || group.label}>
          <h2 className="mb-2 px-1 text-[13px] font-bold text-slate-500 dark:text-slate-400">
            {group.label}
            <span className="ml-2 font-medium text-slate-400 dark:text-slate-500">
              {group.items.length}件
            </span>
          </h2>
          <ul className="flex flex-col gap-3">
            {group.items.map((row, i) => (
              <li key={`${group.ymd}-${row.recordId}-${i}`}>
                <ApoListRowCard row={row} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
