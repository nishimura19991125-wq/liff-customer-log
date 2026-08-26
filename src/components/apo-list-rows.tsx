"use client";

import { LiffCard } from "@/components/liff-chrome";
import { formatCustomerNameForDisplay } from "@/lib/customer-name-display";
import type { ApoListRow } from "@/lib/apo-list-types";

type Props = {
  rows: ApoListRow[];
};

/** 1件の表示。時刻 / 顧客名 / 市区郡 / 見積ステータス */
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

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row, i) => (
        <li key={`${row.recordId}-${i}`}>
          <LiffCard>
            <div className="flex items-start gap-3 px-4 py-4">
              <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-sky-50 py-2 dark:bg-sky-950/40">
                <span className="text-[11px] font-medium text-sky-700 dark:text-sky-300">
                  開始
                </span>
                <span className="text-[18px] font-black tabular-nums leading-none text-sky-900 dark:text-sky-100">
                  {row.scheduledTime || "—"}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-bold leading-snug text-slate-900 dark:text-white">
                  {/* 表示だけ整える。@pocket の値は変更しない */}
                  {formatCustomerNameForDisplay(row.customerName) || "（名称未設定）"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {row.city ? (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {row.city}
                    </span>
                  ) : null}
                  {row.estimateStatus ? (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[12px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {row.estimateStatus}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </LiffCard>
        </li>
      ))}
    </ul>
  );
}
