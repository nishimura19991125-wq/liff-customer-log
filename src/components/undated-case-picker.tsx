"use client";

import { useMemo } from "react";

import type { UndatedCasesState } from "@/hooks/use-undated-construction-cases";
import type { UndatedConstructionCase } from "@/lib/calendar-api-types";

/**
 * 工事日未定案件を検索・選択する部品（タスクS-1）。
 *
 * 空き枠カードの「未定案件を割り当て」で使っていた検索欄・AP/CL担当候補・
 * 「選択中／選び直す」をそのまま切り出したもの。新規登録の
 * 「未定案件を割り当て」タブでも同じ操作感になるよう共有する。
 *
 * 選択状態は呼び出し側が持つ（検索文字列も含めて完全な制御コンポーネント）。
 * ここに状態を持たせると、保存後のリセットのためにエフェクトが必要になる。
 */

export function undatedCaseOptionLabel(c: UndatedConstructionCase): string {
  const meta = [
    c.housingShort,
    c.contractorName,
    c.tNumber ? `T:${c.tNumber}` : "",
  ]
    .filter(Boolean)
    .join(" / ");
  return meta ? `${c.customerName}（${meta}）` : c.customerName;
}

/** 検索欄に一度に出す候補の上限。多すぎると選びづらい */
const MAX_SEARCH_RESULTS = 40;

export function UndatedCasePicker({
  state,
  disabled,
  searchInput,
  onSearchInputChange,
  selectedRecordId,
  onSelectCase,
  onClearSelection,
}: {
  state: UndatedCasesState;
  disabled: boolean;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  selectedRecordId: string;
  onSelectCase: (c: UndatedConstructionCase) => void;
  onClearSelection: () => void;
}) {
  const filtered = useMemo(() => {
    const q = searchInput.trim().normalize("NFKC").toLowerCase();
    if (!q || selectedRecordId) return [];
    const matched: UndatedConstructionCase[] = [];
    for (const c of state.cases) {
      const name = c.customerName.normalize("NFKC").toLowerCase();
      const t = c.tNumber.normalize("NFKC").toLowerCase();
      if (name.includes(q) || t.includes(q)) {
        matched.push(c);
        if (matched.length >= MAX_SEARCH_RESULTS) break;
      }
    }
    return matched;
  }, [state.cases, searchInput, selectedRecordId]);

  function renderCaseButton(c: UndatedConstructionCase) {
    return (
      <button
        type="button"
        className="flex min-h-[44px] w-full flex-col gap-0.5 px-3 py-2 text-left transition hover:bg-emerald-50 active:bg-emerald-100"
        disabled={disabled}
        onClick={() => onSelectCase(c)}
      >
        <span className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-900">
          {c.customerName}
          {c.isMyApCl ? (
            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">
              AP/CL担当
            </span>
          ) : null}
        </span>
        <span className="text-[11px] text-slate-500">
          {[
            c.housingShort,
            c.contractorName,
            c.tNumber ? `T:${c.tNumber}` : "",
          ]
            .filter(Boolean)
            .join(" / ") || "詳細なし"}
        </span>
      </button>
    );
  }

  return (
    <>
      <div className="block">
        <span className="mb-1 block text-[12px] font-bold text-slate-700">
          工事日未定案件（名前検索）{" "}
          <span className="font-semibold text-red-600">必須</span>
          <span className="mt-0.5 block text-[11px] font-normal leading-snug text-slate-500">
            お客様名（またはT番号）の一部を入力して候補から選んでください（お客様情報の施工予定日が空の案件。キャンセルは除外）
            {state.status === "ok" ? `（未定 ${state.cases.length}件）` : ""}
          </span>
        </span>
        <input
          type="search"
          inputMode="search"
          autoComplete="off"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200"
          value={searchInput}
          disabled={
            disabled || state.status === "loading" || state.status === "err"
          }
          placeholder={
            state.status === "loading"
              ? "未定案件を読み込み中…"
              : state.status === "err"
                ? "取得に失敗しました"
                : state.cases.length === 0
                  ? "割り当て可能な未定案件がありません"
                  : "例: 山田 / T番号"
          }
          onChange={(e) => onSearchInputChange(e.target.value)}
        />
        {state.status === "ok" && searchInput.trim() && !selectedRecordId ? (
          <ul className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-sm">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-[12px] text-slate-500">
                一致する案件がありません
              </li>
            ) : (
              filtered.map((c) => <li key={c.customerInfoRecordId}>{renderCaseButton(c)}</li>)
            )}
          </ul>
        ) : null}
        {state.status === "ok" && !searchInput.trim() && !selectedRecordId ? (
          <div className="mt-3">
            <p className="mb-1.5 text-[12px] font-bold text-slate-700">
              あなたのAP/CL担当候補
              <span className="ml-1 font-normal text-slate-500">
                （{state.myCases.length}件）
              </span>
            </p>
            {state.needsStaffBind ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-semibold leading-relaxed text-amber-900 ring-1 ring-amber-100">
                スタッフ紐付け後に、あなたのAP/CL担当の未定案件がここに表示されます。全案件は上の名前検索で選べます。
              </p>
            ) : state.myCases.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
                担当の未定案件はありません。上の検索から他の案件を選べます。
              </p>
            ) : (
              <ul className="max-h-56 overflow-y-auto rounded-xl border border-sky-200 bg-sky-50/40 py-1 shadow-sm">
                {state.myCases.map((c) => (
                  <li key={c.customerInfoRecordId}>{renderCaseButton(c)}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
      {selectedRecordId ? (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-900 ring-1 ring-emerald-100">
          選択中: {searchInput}
          <button
            type="button"
            className="ml-2 min-h-[44px] text-[11px] font-bold text-emerald-700 underline"
            disabled={disabled}
            onClick={onClearSelection}
          >
            選び直す
          </button>
        </p>
      ) : null}
      {state.status === "err" && state.error ? (
        <p className="mt-2 text-[12px] font-semibold text-red-700">
          {state.error}
        </p>
      ) : null}
    </>
  );
}
