"use client";

import { useMemo, useRef, useState } from "react";

import {
  buildConstructionRequestTemplate,
  CONSTRUCTION_REQUEST_STATUS_DONE,
} from "@/lib/construction-request-template";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

/**
 * 新規施工依頼テンプレートのコピー（タスクH）。
 *
 * customer-info-edit-form.tsx が1,000行を超えているため別コンポーネントに切り出し、
 * 編集フォームからは表示条件の判定と値の受け渡しだけを行う。
 *
 * 「新規施工依頼する/しない」は **LIFF 上だけの選択**で @pocket には保存しない。
 * 画面内の state としてのみ持つ。
 */

const STATUS_UPDATE_FAILED =
  "コピーしました。ただしステータスの更新に失敗しました。手動で変更してください。";

type CopyOutcome =
  | { kind: "ok" }
  | { kind: "ok-status-failed" }
  | { kind: "error"; message: string };

/**
 * クリップボードへ書き込む。
 *
 * LIFF は WebView 上で動き、navigator.clipboard が無い / 権限が無い環境がある。
 * 失敗したら false を返し、呼び出し側が手動選択用のテキストエリアへ切り替える。
 */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 権限拒否・非セキュアコンテキストなど。フォールバックへ落とす
  }
  return false;
}

export function ConstructionRequestCopyPanel({
  recordId,
  values,
  idToken,
  disabled,
  onStatusUpdated,
  onSessionExpired,
}: {
  recordId: string;
  /** 現在のフォーム値（テンプレートの組み立てと保存の両方に使う） */
  values: CustomerInfoFormValues;
  idToken: string | null;
  disabled?: boolean;
  /** ステータス更新が成功したとき。画面の値を「済」に揃える */
  onStatusUpdated: (status: string) => void;
  onSessionExpired?: () => void;
}) {
  const [wantsRequest, setWantsRequest] = useState<"" | "する" | "しない">("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CopyOutcome | null>(null);
  const [showManualCopy, setShowManualCopy] = useState(false);
  const manualRef = useRef<HTMLTextAreaElement | null>(null);

  const template = useMemo(
    () => buildConstructionRequestTemplate(values),
    [values],
  );

  async function updateStatusToDone(): Promise<boolean> {
    const token = idToken;
    if (!token) return false;
    const res = await fetch(
      `/api/customer-info/records/${encodeURIComponent(recordId)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        // 既存の保存経路をそのまま使う。専用 API は作らない。
        // 部分送信は必須チェックに引っかかるため、現在のフォーム値一式に
        // 施工依頼ステータスだけを足して送る
        body: JSON.stringify({
          formValues: {
            ...values,
            constructionRequestStatus: CONSTRUCTION_REQUEST_STATUS_DONE,
          },
        }),
      },
    );

    if (res.status === 401) {
      const raw = await res.text();
      let data: unknown = {};
      try {
        data = raw.trim() ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }
      if (isLineSessionExpiredPayload(data)) {
        onSessionExpired?.();
        return false;
      }
    }
    return res.ok;
  }

  async function handleCopy() {
    if (!template.ok || busy) return;
    setBusy(true);
    setOutcome(null);
    setShowManualCopy(false);

    try {
      // 先にコピー。失敗したらステータスは触らない
      const copied = await writeToClipboard(template.text);
      if (!copied) {
        setShowManualCopy(true);
        setOutcome({
          kind: "error",
          message:
            "この端末では自動コピーができませんでした。下の枠内の文章を長押しして全選択し、手動でコピーしてください。",
        });
        return;
      }

      const updated = await updateStatusToDone();
      if (updated) {
        onStatusUpdated(CONSTRUCTION_REQUEST_STATUS_DONE);
        setOutcome({ kind: "ok" });
      } else {
        setOutcome({ kind: "ok-status-failed" });
      }
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
      <p className="text-[12px] font-bold text-slate-700">新規施工依頼</p>

      <fieldset className="mt-2">
        <legend className="text-[11px] font-semibold text-slate-600">
          新規施工依頼する/しない
        </legend>
        <div className="mt-1 flex gap-2">
          {(["する", "しない"] as const).map((opt) => (
            <label
              key={opt}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium ${
                wantsRequest === opt
                  ? "border-emerald-400 bg-emerald-50 text-emerald-900"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              <input
                type="radio"
                name={`construction-request-${recordId}`}
                className="size-4 border-slate-300 text-emerald-600"
                value={opt}
                checked={wantsRequest === opt}
                disabled={disabled || busy}
                onChange={() => {
                  setWantsRequest(opt);
                  setOutcome(null);
                  setShowManualCopy(false);
                }}
              />
              {opt}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          この選択は @pocket に保存されません（この画面の中だけの切り替えです）
        </p>
      </fieldset>

      {wantsRequest === "する" ? (
        <div className="mt-3">
          {template.ok ? (
            <>
              {/* 何がコピーされるかを必ず見せる */}
              <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[12px] leading-relaxed text-slate-800">
                {template.text}
              </pre>

              <button
                type="button"
                disabled={disabled || busy || !idToken}
                onClick={() => void handleCopy()}
                className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:bg-slate-300"
              >
                {busy ? "処理中…" : "コピーして施工依頼ステータスを済にする"}
              </button>

              {showManualCopy ? (
                <div className="mt-2">
                  <label
                    htmlFor={`manual-copy-${recordId}`}
                    className="block text-[11px] font-bold text-slate-600"
                  >
                    手動コピー用（長押しで全選択してください）
                  </label>
                  <textarea
                    id={`manual-copy-${recordId}`}
                    ref={manualRef}
                    readOnly
                    rows={12}
                    value={template.text}
                    onFocus={(e) => e.currentTarget.select()}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-[12px] leading-relaxed text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      manualRef.current?.focus();
                      manualRef.current?.select();
                    }}
                    className="mt-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[12px] font-semibold text-slate-600"
                  >
                    全選択する
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <p
              role="alert"
              aria-live="assertive"
              className="rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-2 text-[12px] font-bold leading-relaxed text-amber-900"
            >
              設置種別が未選択のため、依頼文を作成できません。設置種別を選んでから
              もう一度お試しください。
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
          {outcome?.kind === "ok-status-failed" ? (
            <p
              role="alert"
              aria-live="assertive"
              className="mt-1 rounded-lg border-2 border-amber-400 bg-amber-50 px-2.5 py-2 text-[12px] font-bold leading-relaxed text-amber-900"
            >
              ⚠ {STATUS_UPDATE_FAILED}
            </p>
          ) : null}
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
