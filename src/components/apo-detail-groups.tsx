"use client";

import { useId, useState } from "react";

import { LiffCard } from "@/components/liff-chrome";
import type { ApoDetailGroupView } from "@/lib/apo-detail-types";

/**
 * 詳細のグループ表示。グループごとに折りたためる。
 * 初期状態は全グループ「開」。全項目を確認するための画面なので、
 * 既定で閉じると目的と逆行する
 */
function ApoDetailGroup({ group }: { group: ApoDetailGroupView }) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();

  return (
    <LiffCard>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-[13px] font-bold text-slate-900 dark:text-white">
          {group.title}
        </span>
        <span
          aria-hidden
          className={`text-xl font-light text-slate-400 transition-transform duration-200 dark:text-slate-500 ${
            open ? "rotate-180" : ""
          }`}
        >
          ⌄
        </span>
      </button>

      {open ? (
        <dl id={bodyId} className="border-t border-slate-100 dark:border-slate-800">
          {group.items.map((item) => (
            <div
              key={item.label}
              className="border-b border-slate-100 px-4 py-3 last:border-b-0 dark:border-slate-800"
            >
              <dt className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                {item.label}
              </dt>
              {/*
                値は加工せずそのまま出す。長文（ご家族の特徴・会話した内容・
                その他共有事項）は改行を含むので whitespace-pre-wrap で保つ。
                break-words は長い URL などでの横はみ出し防止
              */}
              <dd className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-slate-900 dark:text-white">
                {item.value || (
                  <span className="text-slate-400 dark:text-slate-500">未入力</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </LiffCard>
  );
}

export function ApoDetailGroups({ groups }: { groups: ApoDetailGroupView[] }) {
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <ApoDetailGroup key={group.title} group={group} />
      ))}
    </div>
  );
}
