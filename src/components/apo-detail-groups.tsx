"use client";

import type { ApoDetailGroupView } from "@/lib/apo-detail-types";

/**
 * アポ情報の詳細（11項目）の表示。
 *
 * グループごとの折りたたみは持たない。カード自体がアコーディオンなので、
 * 中でさらに折りたたむと操作が煩雑になるため。見出しだけ残す。
 */
export function ApoDetailGroups({ groups }: { groups: ApoDetailGroupView[] }) {
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <section key={group.title}>
          <h3 className="px-1 text-[12px] font-bold text-slate-500 dark:text-slate-400">
            {group.title}
          </h3>
          <dl className="mt-1 rounded-xl border border-slate-200 dark:border-slate-800">
            {group.items.map((item) => (
              <div
                key={item.label}
                className="border-b border-slate-100 px-3 py-2.5 last:border-b-0 dark:border-slate-800"
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
                    <span className="text-slate-400 dark:text-slate-500">
                      未入力
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
