"use client";

import { useId, useMemo, useState } from "react";

import { ManualCopyFallback } from "@/components/manual-copy-fallback";
import { writeToClipboard } from "@/lib/clipboard-copy";
import { COPY_BUTTON_LABEL } from "@/lib/copy-panel-labels";
import { buildKannaProjectName } from "@/lib/kanna-project-name";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

/**
 * KANNA の案件名のコピー。画面の見出しは「KANNA案件名登録」。
 *
 * タイムツリー登録用（contractor-summary-copy-panel.tsx）と同じ形にそろえる。
 * customer-info-edit-form.tsx が1,200行を超えているため別コンポーネントにする。
 *
 * タイムツリー登録用と同じく、コピーしても @pocket は一切更新しない。
 * 新規施工依頼のようなステータス更新は行わない。
 */

type CopyOutcome = { kind: "ok" } | { kind: "error"; message: string };

export function KannaProjectNameCopyPanel({
  values,
  disabled,
}: {
  /** 現在のフォーム値 */
  values: CustomerInfoFormValues;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CopyOutcome | null>(null);
  const [showManualCopy, setShowManualCopy] = useState(false);
  const bodyId = useId();

  const projectName = useMemo(() => buildKannaProjectName(values), [values]);

  async function handleCopy() {
    if (!projectName || busy) return;
    setBusy(true);
    setOutcome(null);
    setShowManualCopy(false);

    try {
      const copied = await writeToClipboard(projectName);
      if (!copied) {
        setShowManualCopy(true);
        setOutcome({
          kind: "error",
          message:
            "この端末では自動コピーができませんでした。下の枠内の文章を長押しして全選択し、手動でコピーしてください。",
        });
        return;
      }
      setOutcome({ kind: "ok" });
    } catch {
      setOutcome({
        kind: "error",
        message:
          "コピーに失敗しました。下の枠内の文章を手動でコピーしてください。",
      });
      setShowManualCopy(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[12px] font-bold text-slate-700">KANNA案件名登録</p>

      {/* 開閉のトグル。既存2つと同じ形に揃える */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        disabled={disabled || busy}
        onClick={() => {
          setOpen((v) => !v);
          setOutcome(null);
          setShowManualCopy(false);
        }}
        className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[13px] font-bold text-emerald-900 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
      >
        {open ? "閉じる" : "送る"}
      </button>

      {open ? (
        <div id={bodyId} className="mt-3">
          {projectName ? (
            <>
              {/* 何がコピーされるかを必ず見せる */}
              <pre className="whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[12px] leading-relaxed text-slate-800">
                {projectName}
              </pre>

              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => void handleCopy()}
                className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:bg-slate-300"
              >
                {busy ? "処理中…" : COPY_BUTTON_LABEL}
              </button>

              {showManualCopy ? (
                <ManualCopyFallback text={projectName} rows={2} />
              ) : null}
            </>
          ) : (
            <p
              role="alert"
              aria-live="assertive"
              className="rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-2 text-[12px] font-bold leading-relaxed text-amber-900"
            >
              お客様名が入力されていないため、KANNA の案件名を作成できません。
            </p>
          )}

          {/* 成否の通知。要素は出し入れせず常に置いて読み上げの取りこぼしを防ぐ */}
          <p
            role="status"
            aria-live="polite"
            className="mt-2 text-[12px] font-bold leading-relaxed text-emerald-800"
          >
            {outcome?.kind === "ok" ? "コピーしました" : ""}
          </p>
          {outcome?.kind === "error" ? (
            <p
              role="alert"
              aria-live="assertive"
              className="mt-1 rounded-lg border border-red-300 bg-red-50 px-2.5 py-2 text-[12px] font-bold leading-relaxed text-red-800"
            >
              {outcome.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
