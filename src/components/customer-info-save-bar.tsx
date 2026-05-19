"use client";

import { forwardRef } from "react";

import { LiffPrimaryButton } from "@/components/liff-chrome";

export type CustomerInfoSaveFeedback = {
  kind: "ok" | "err";
  text: string;
  savedAt?: string;
};

type CustomerInfoSaveBarProps = {
  saving: boolean;
  disabled: boolean;
  feedback: CustomerInfoSaveFeedback | null;
  onSave: () => void;
};

export const CustomerInfoSaveBar = forwardRef<
  HTMLDivElement,
  CustomerInfoSaveBarProps
>(function CustomerInfoSaveBar(
  { saving, disabled, feedback, onSave },
  ref,
) {
  return (
    <div
      ref={ref}
      className="sticky bottom-0 z-20 -mx-4 mt-5 border-t border-slate-200/90 bg-white/95 px-4 py-3 shadow-[0_-10px_28px_rgba(15,23,42,0.1)] backdrop-blur-md pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      {saving ? (
        <p
          className="mb-3 rounded-xl bg-slate-100 px-4 py-3 text-center text-[14px] font-bold text-slate-700"
          role="status"
        >
          保存しています…
        </p>
      ) : null}

      {!saving && feedback?.kind === "ok" ? (
        <div
          className="mb-3 rounded-xl border-2 border-emerald-400 bg-emerald-50 px-4 py-3.5 text-center ring-2 ring-emerald-200/80"
          role="status"
          aria-live="polite"
        >
          <p className="text-[17px] font-bold text-emerald-900">
            ✓ 保存できました
          </p>
          <p className="mt-1 text-[13px] font-semibold leading-relaxed text-emerald-800">
            {feedback.text}
            {feedback.savedAt ? `（${feedback.savedAt}）` : ""}
          </p>
        </div>
      ) : null}

      {!saving && feedback?.kind === "err" ? (
        <div
          className="mb-3 rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3.5"
          role="alert"
          aria-live="assertive"
        >
          <p className="text-[16px] font-bold text-red-800">
            保存できませんでした
          </p>
          <p className="mt-1 text-[13px] font-semibold leading-relaxed text-red-700">
            {feedback.text}
          </p>
        </div>
      ) : null}

      <LiffPrimaryButton
        type="button"
        disabled={disabled || saving}
        onClick={onSave}
      >
        {saving
          ? "保存中…"
          : feedback?.kind === "ok"
            ? "もう一度保存する"
            : "保存して @pocket に反映"}
      </LiffPrimaryButton>
    </div>
  );
});
