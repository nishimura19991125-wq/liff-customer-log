"use client";

import { useId, useRef } from "react";

/**
 * 自動コピーができない端末向けの手動コピー欄。
 *
 * 元は construction-request-copy-panel.tsx にあったもの。施工会社向けの
 * 一行サマリ（タスクU）でも同じ扱いが要るので切り出した。見た目・挙動は同じ。
 */
export function ManualCopyFallback({
  text,
  rows = 12,
}: {
  text: string;
  /** 一行サマリのように短い本文では小さくする */
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const id = useId();

  return (
    <div className="mt-2">
      <label htmlFor={id} className="block text-[11px] font-bold text-slate-600">
        手動コピー用（長押しで全選択してください）
      </label>
      <textarea
        id={id}
        ref={ref}
        readOnly
        rows={rows}
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-[12px] leading-relaxed text-slate-800"
      />
      <button
        type="button"
        onClick={() => {
          ref.current?.focus();
          ref.current?.select();
        }}
        className="mt-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[12px] font-semibold text-slate-600"
      >
        全選択する
      </button>
    </div>
  );
}
