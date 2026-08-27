"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { StaffNameSuggestCombobox } from "@/components/staff-name-suggest-combobox";
import { calendarSubmitCatchMessage } from "@/lib/calendar-submit-client";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";
import {
  commitStaffNameInput,
  isExactStaffName,
  mergeStaffNameOptions,
} from "@/lib/staff-name-options";

/**
 * 工事対応者（スタッフ名簿）の入力欄と、その候補取得。
 *
 * もとは liff-calendar-month-page.tsx の中にあったものを、そのまま切り出した。
 * 第3段階 3-3 で「未定案件を割り当て」からも工事対応者を送るようになり、
 * 別ファイルのフォーム（calendar-assign-undated-case-form.tsx）からも
 * 同じ入力欄が要るため。**処理は移しただけで変えていない。**
 */

export type HandlerStaffRow = {
  staffRecordId: string;
  name: string;
  label: string;
};

export type HandlerStaffListStatus = "idle" | "loading" | "ok" | "err";

export function parseConstructionHandlerStaffApiPayload(payload: {
  handlers?: unknown;
  registrants?: unknown;
}): HandlerStaffRow[] {
  const raw = payload.handlers ?? payload.registrants;
  if (!Array.isArray(raw)) return [];
  const out: HandlerStaffRow[] = [];
  for (const x of raw) {
    if (typeof x !== "object" || x === null) continue;
    const o = x as Record<string, unknown>;
    const sid =
      typeof o.staffRecordId === "string"
        ? o.staffRecordId.trim()
        : o.staffRecordId != null
          ? String(o.staffRecordId).trim()
          : "";
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const label = typeof o.label === "string" ? o.label.trim() : name;
    if (!sid || !name) continue;
    out.push({ staffRecordId: sid, name, label: label || name });
  }
  return out;
}

export const HANDLER_STAFF_SELECT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200";

export function resolveHandlerStaffIdFromInput(
  rows: HandlerStaffRow[],
  raw: string,
): string {
  const labels = rows.map((r) => r.label || r.name);
  const committed = commitStaffNameInput(labels, raw);
  if (!committed) return "";
  const want = committed.normalize("NFKC").trim();
  const byLabel = rows.filter(
    (r) => (r.label || r.name).normalize("NFKC").trim() === want,
  );
  if (byLabel.length === 1) return byLabel[0]!.staffRecordId;
  const byName = rows.filter((r) => r.name.normalize("NFKC").trim() === want);
  return byName.length === 1 ? byName[0]!.staffRecordId : "";
}

export function matchHandlerStaffRecordId(
  handlerName: string | undefined,
  rows: HandlerStaffRow[],
): string {
  const target = handlerName?.normalize("NFKC").trim();
  if (!target) return "";
  const matches = rows.filter(
    (row) => row.name.normalize("NFKC").trim() === target,
  );
  return matches.length === 1 ? matches[0]!.staffRecordId : "";
}

export async function fetchConstructionHandlerStaffRows(
  idToken: string,
): Promise<
  | { ok: true; rows: HandlerStaffRow[] }
  | { ok: false; error: string; sessionExpired?: boolean }
> {
  try {
    const res = await fetch("/api/calendar/construction-handler-staff", {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const data = (await res.json()) as {
      handlers?: unknown;
      registrants?: unknown;
      error?: string;
    };
    if (isLineSessionExpiredPayload(data)) {
      return {
        ok: false,
        error: "セッションが切れました",
        sessionExpired: true,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        error:
          typeof data.error === "string" && data.error.trim()
            ? data.error.trim()
            : "工事対応者リストを取得できませんでした",
      };
    }
    return { ok: true, rows: parseConstructionHandlerStaffApiPayload(data) };
  } catch (e) {
    return { ok: false, error: calendarSubmitCatchMessage(e) };
  }
}

export function ConstructionHandlerStaffSelect({
  submitting,
  canSubmit,
  handlerListStatus,
  handlerListError,
  handlerRows,
  selectedHandlerStaffId,
  setSelectedHandlerStaffId,
  required = true,
  inputId = "construction-handler-staff",
  fallbackDisplayName = "",
  resolveStaffIdRef,
}: {
  submitting: boolean;
  canSubmit: boolean;
  handlerListStatus: HandlerStaffListStatus;
  handlerListError: string;
  handlerRows: HandlerStaffRow[];
  selectedHandlerStaffId: string;
  setSelectedHandlerStaffId: (id: string) => void;
  required?: boolean;
  inputId?: string;
  /** 変更編集時: 名簿に無い現在名も入力欄・候補に残す */
  fallbackDisplayName?: string;
  /** 保存直前に入力を確定してスタッフIDを取る */
  resolveStaffIdRef?: MutableRefObject<(() => string) | null>;
}) {
  const nameOptions = useMemo(
    () =>
      mergeStaffNameOptions(
        handlerRows.map((r) => r.label || r.name),
        fallbackDisplayName,
      ),
    [handlerRows, fallbackDisplayName],
  );

  const selectedLabel = useMemo(() => {
    const row = handlerRows.find(
      (r) => r.staffRecordId === selectedHandlerStaffId,
    );
    if (row) return row.label || row.name;
    return fallbackDisplayName.trim();
  }, [handlerRows, selectedHandlerStaffId, fallbackDisplayName]);

  const [inputValue, setInputValue] = useState(selectedLabel);
  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;

  useEffect(() => {
    setInputValue(selectedLabel);
  }, [selectedLabel, selectedHandlerStaffId]);

  useEffect(() => {
    if (!resolveStaffIdRef) return;
    resolveStaffIdRef.current = () => {
      const committed = commitStaffNameInput(
        nameOptions,
        inputValueRef.current,
      );
      if (!committed) return "";
      return resolveHandlerStaffIdFromInput(handlerRows, committed);
    };
    return () => {
      resolveStaffIdRef.current = null;
    };
  }, [resolveStaffIdRef, nameOptions, handlerRows]);

  const selectDisabled =
    submitting ||
    !canSubmit ||
    handlerListStatus === "idle" ||
    handlerListStatus === "loading" ||
    handlerListStatus === "err" ||
    (handlerListStatus === "ok" && handlerRows.length === 0);

  const loading =
    handlerListStatus === "idle" || handlerListStatus === "loading";

  function applyInput(next: string) {
    setInputValue(next);
    if (!next.trim()) {
      setSelectedHandlerStaffId("");
      return;
    }
    if (isExactStaffName(nameOptions, next)) {
      setSelectedHandlerStaffId(
        resolveHandlerStaffIdFromInput(handlerRows, next),
      );
      return;
    }
    // 途中入力は未確定扱いにする（保存不可）
    setSelectedHandlerStaffId("");
  }

  return (
    <label className="mt-3 block">
      <span className="mb-1 block text-[12px] font-bold text-slate-700">
        工事対応者{" "}
        {required ? (
          <span className="font-semibold text-red-600">必須</span>
        ) : (
          <span className="font-medium text-slate-500">（変更）</span>
        )}
        <span className="block text-[11px] font-normal leading-snug text-slate-500">
          スタッフ名と完全一致が必要です。未入力時は全員表示、Enter /
          フォーカス外しで先頭候補を確定（工事対応稼働「稼働」）
        </span>
      </span>
      <StaffNameSuggestCombobox
        id={inputId}
        label="工事対応者"
        value={inputValue}
        options={nameOptions}
        disabled={selectDisabled}
        loading={loading}
        inputClassName={HANDLER_STAFF_SELECT_CLASS}
        onChange={applyInput}
      />
      {handlerListStatus === "err" && handlerListError ? (
        <p className="mt-1 text-[12px] leading-relaxed text-red-700">
          {handlerListError}
        </p>
      ) : null}
      {handlerListStatus === "ok" && handlerRows.length === 0 ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900 ring-1 ring-amber-100">
          工事対応稼働状況が「稼働」の社員がありません。@pocket
          のスタッフ名簿を確認してください。
        </p>
      ) : null}
    </label>
  );
}
