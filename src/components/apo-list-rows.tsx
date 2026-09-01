"use client";

import { useId, useState } from "react";

import { ApoDetailGroups } from "@/components/apo-detail-groups";
import { LiffCard } from "@/components/liff-chrome";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import { formatCustomerNameForDisplay } from "@/lib/customer-name-display";
import {
  formatApoListScheduledDateTime,
  groupApoListRowsByDate,
  hasApoListGiftCoupon,
  nextOpenApoRecordId,
} from "@/lib/apo-list-display";
import type { ApoDetailPayload } from "@/lib/apo-detail-types";
import type { ApoListRow } from "@/lib/apo-list-types";
import { LIFF_SWR_DEFAULT_OPTIONS } from "@/lib/liff-swr";
import { safeHttpsUrl } from "@/lib/safe-external-url";

type Props = {
  rows: ApoListRow[];
  idToken: string | null;
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

/**
 * 1件分。お客様名 → バッジ4種 → 商談・資料送付予定日時。
 *
 * カード全体が詳細の開閉トグル。開いている間だけ詳細を取りに行く
 * （閉じているカードは path を null にしてフェッチしない）。
 * 取得は recordId 単位で60秒キャッシュされるので、開き直しても増えない。
 */
function ApoListRowCard({
  row,
  idToken,
  open,
  onToggle,
}: {
  row: ApoListRow;
  idToken: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const bodyId = useId();

  const { data, error, isLoading } = useLiffSwr<
    ApoDetailPayload & { error?: string }
  >(
    open ? `/api/apo-list/${encodeURIComponent(row.recordId)}` : null,
    idToken,
    LIFF_SWR_DEFAULT_OPTIONS,
  );

  /**
   * 担当外（403）と存在しない（404）は区別しない。
   * 文言を分けると他人の案件の有無が分かってしまうため
   */
  const notAvailable = Boolean(error) || Boolean(data?.error);

  return (
    <LiffCard>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className="block w-full px-4 py-4 text-left active:opacity-70"
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
      </button>

      {/**
       * Dropbox フォルダ。**開閉トグルの外**に置く。
       * 上は詳細を開くための button なので、その中に更にリンクを入れると
       * 入れ子になり、押しても開閉かリンクかが定まらない。
       *
       * URL はサーバ側でも https のみ通しているが、href に置く直前でも
       * もう一度確かめる（お客様情報の書類フォルダと同じ流儀）。
       * 通らなければリンクにせず「未設定」と出す。押せないボタンを
       * 置くより状態が分かる。
       */}
      <div className="px-4 pb-4">
        {(() => {
          const href = safeHttpsUrl(row.dropboxUrl);
          return href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[36px] items-center rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-1 text-[13px] font-bold text-sky-900 transition active:scale-[0.98] active:bg-sky-100 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200"
            >
              Dropbox を開く
            </a>
          ) : (
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              Dropbox: 未設定
            </p>
          );
        })()}
      </div>

      {open ? (
        <div
          id={bodyId}
          className="border-t border-slate-100 px-4 py-3 dark:border-slate-800"
        >
          {isLoading && !data ? (
            <p
              role="status"
              aria-live="polite"
              className="py-2 text-center text-[13px] text-slate-500 dark:text-slate-400"
            >
              読み込み中…
            </p>
          ) : notAvailable ? (
            <p
              role="alert"
              aria-live="assertive"
              className="rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-2 text-[12px] font-bold leading-relaxed text-amber-900"
            >
              この案件は表示できません。時間をおいてお試しください。
            </p>
          ) : data && !data.configured ? (
            <p
              role="alert"
              aria-live="assertive"
              className="rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-2 text-[12px] font-bold leading-relaxed text-amber-900"
            >
              アポ情報は環境変数設定後に利用できます。
            </p>
          ) : data ? (
            /* お客様名はカード側に出ているので、ここでは繰り返さない */
            <ApoDetailGroups groups={data.groups} />
          ) : null}
        </div>
      ) : null}
    </LiffCard>
  );
}

export function ApoListRows({ rows, idToken }: Props) {
  /** 開いているカードの recordId。同時に開けるのは1件だけ */
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);

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
                <ApoListRowCard
                  row={row}
                  idToken={idToken}
                  open={openRecordId === row.recordId}
                  // 開いているものを押したら閉じる。別のものを押したら差し替え
                  onToggle={() =>
                    setOpenRecordId((current) =>
                      nextOpenApoRecordId(current, row.recordId),
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
