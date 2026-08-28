"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ConstructionHandlerStaffSelect,
  type HandlerStaffListStatus,
  type HandlerStaffRow,
} from "@/components/construction-handler-staff-select";
import type {
  CalendarApiPayload,
  CalendarMonthApiItem,
  CalendarRecordMonthPatch,
} from "@/lib/calendar-api-types";
import {
  MOVE_CASE_CONFIRM_WARNING,
  MOVE_CONSTRUCTION_CASE_PATH,
  buildMoveCaseConfirmLines,
  buildMoveCaseConfirmSubject,
  buildMoveCaseConfirmTitle,
  moveCaseConfirmActionLabel,
  type MoveCaseConfirmInput,
  type MoveConstructionCaseResponse,
} from "@/lib/calendar-move-case-messages";
import {
  calendarSubmitCatchMessage,
  idTokenForConstructionSubmit,
} from "@/lib/calendar-submit-client";
import {
  CALENDAR_SLOT_CONFLICT_MESSAGE,
  isCalendarSlotConflictApiResponse,
} from "@/lib/calendar-slot-verify-client";
import {
  contractorNameFromKey,
  dayKeyInMonth,
  emptySlotsFromDayItems,
} from "@/lib/calendar-move-target-slots";
import { formatDisplayYmd } from "@/lib/format-display-ymd";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";

/**
 * 案件の工事日を別の日へ移す（工事日変更 M-3）。
 *
 * 3-3 で「空き枠を削除せず、枠のレコードを案件に変える」形にしたため、
 * 工事日だけを書き換えると枠の対応が崩れる。移動先の枠へ移し、
 * 元のレコードを空き枠へ戻す（M-2 の /api/calendar/move-construction-case）。
 *
 * ■ 空き枠の候補は月次ペイロードから作る
 * data.byDay には、その月の全日ぶんの category:"empty" と contractorKey が
 * 既に入っている。同じ月の中を移すだけなら **@pocket の呼び出しは 0 回**。
 * 別の月を選んだときだけ、その月のカレンダーを1回取りにいく。
 *
 * ■ pickEmptySlotForDay は使えない
 * あちらは施工会社の一致を必須にして1件しか返さない。移動は施工会社を
 * またぐので、その日の枠を**全部出して選ばせる**。3-3 の割り当ては
 * あちらに依存しているので、そちらは触らない。
 */

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200";
const DIALOG_BUTTON_CLASS =
  "w-full min-h-[48px] rounded-xl px-4 py-3 text-[14px] font-bold shadow-sm transition active:scale-[0.99] disabled:opacity-50";

export function CalendarMoveCasePanel({
  item,
  sourceDayKey,
  idToken,
  viewYear,
  viewMonth,
  byDay,
  calendarApiPath,
  handlerFromStaff,
  handlerListStatus,
  handlerListError,
  handlerRows,
  onSaved,
  onSessionExpired,
}: {
  item: CalendarMonthApiItem;
  /** カレンダー上でこの案件が出ている日（＝移動元の日付） */
  sourceDayKey: string;
  idToken: string | null;
  viewYear: number;
  viewMonth: number;
  /** 表示中の月の全日ぶん。同じ月の空き枠はここから作る */
  byDay: Record<string, CalendarMonthApiItem[]> | undefined;
  calendarApiPath: string;
  handlerFromStaff: boolean;
  handlerListStatus: HandlerStaffListStatus;
  handlerListError: string;
  handlerRows: HandlerStaffRow[];
  onSaved: (patch?: CalendarRecordMonthPatch | null) => Promise<void>;
  onSessionExpired?: () => void;
}) {
  const recordId = item.recordId?.trim() ?? "";
  const [open, setOpen] = useState(false);
  const [targetDayKey, setTargetDayKey] = useState("");
  /** 選んだ空き枠の recordId。空文字＝新規作成 */
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [selectedHandlerStaffId, setSelectedHandlerStaffId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  /** 別の月を選んだときだけ取りにいく */
  const [otherMonth, setOtherMonth] = useState<{
    key: string;
    status: "loading" | "ok" | "err";
    byDay: Record<string, CalendarMonthApiItem[]>;
    error: string;
  } | null>(null);

  const sourceContractor = contractorNameFromKey(item.contractorKey);

  const canOpen = Boolean(idToken && recordId && sourceDayKey.trim());

  function reset() {
    setTargetDayKey("");
    setSelectedSlotId("");
    setSelectedHandlerStaffId("");
    setConfirming(false);
    setOtherMonth(null);
  }

  const needsOtherMonth = Boolean(
    targetDayKey && !dayKeyInMonth(targetDayKey, viewYear, viewMonth),
  );
  const otherMonthKey = targetDayKey.slice(0, 7);

  useEffect(() => {
    if (!open || !needsOtherMonth || !idToken) return;
    if (otherMonth?.key === otherMonthKey && otherMonth.status !== "err") {
      return;
    }
    let cancelled = false;
    void (async () => {
      const [y, m] = otherMonthKey.split("-");
      const qs = new URLSearchParams({
        year: String(Number(y)),
        month: String(Number(m)),
      });
      setOtherMonth({
        key: otherMonthKey,
        status: "loading",
        byDay: {},
        error: "",
      });
      try {
        const res = await fetch(`${calendarApiPath}?${qs}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = (await res.json()) as CalendarApiPayload & {
          error?: string;
        };
        if (cancelled) return;
        if (res.status === 401 && isLineSessionExpiredPayload(data)) {
          onSessionExpired?.();
          return;
        }
        if (!res.ok) {
          setOtherMonth({
            key: otherMonthKey,
            status: "err",
            byDay: {},
            error:
              typeof data.error === "string"
                ? data.error
                : "移動先の月のカレンダーを取得できませんでした",
          });
          return;
        }
        setOtherMonth({
          key: otherMonthKey,
          status: "ok",
          byDay: data.byDay ?? {},
          error: "",
        });
      } catch {
        if (!cancelled) {
          setOtherMonth({
            key: otherMonthKey,
            status: "err",
            byDay: {},
            error: "通信に失敗しました",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    needsOtherMonth,
    otherMonthKey,
    otherMonth?.key,
    otherMonth?.status,
    idToken,
    calendarApiPath,
    onSessionExpired,
  ]);

  const slotsSource = needsOtherMonth ? otherMonth?.byDay : byDay;
  const slots = useMemo(
    () =>
      targetDayKey ? emptySlotsFromDayItems(slotsSource?.[targetDayKey]) : [],
    [slotsSource, targetDayKey],
  );
  const slotsLoading = needsOtherMonth && otherMonth?.status === "loading";
  const slotsError = needsOtherMonth ? (otherMonth?.error ?? "") : "";

  const selectedSlot = slots.find((s) => s.recordId === selectedSlotId) ?? null;

  const confirmInput: MoveCaseConfirmInput = {
    customerName: item.line1?.trim() ?? "",
    tNumber: item.tNumber?.trim() ?? "",
    sourceDayKey,
    targetDayKey,
    sourceContractor,
    targetSlotContractor: selectedSlot ? selectedSlot.contractorName : null,
  };

  const handlerMissing = handlerFromStaff && !selectedHandlerStaffId.trim();
  const sameDay = Boolean(targetDayKey) && targetDayKey === sourceDayKey;
  const canConfirm =
    canOpen && Boolean(targetDayKey) && !sameDay && !handlerMissing;

  async function handleMove() {
    if (!canConfirm) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const token = await idTokenForConstructionSubmit(
        idToken,
        onSessionExpired,
      );
      if (!token) return;

      const res = await fetch(MOVE_CONSTRUCTION_CASE_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sourceRecordId: recordId,
          targetDayKey,
          ...(selectedSlotId ? { slotRecordId: selectedSlotId } : {}),
          ...(item.tNumber?.trim()
            ? { expectedTNumber: item.tNumber.trim() }
            : {}),
          ...(handlerFromStaff
            ? { constructionHandlerStaffRecordId: selectedHandlerStaffId }
            : {}),
          viewYear,
          viewMonth,
        }),
      });

      const raw = await res.text();
      let data: MoveConstructionCaseResponse = {};
      if (raw.trim()) {
        try {
          data = JSON.parse(raw) as MoveConstructionCaseResponse;
        } catch {
          data = {};
        }
      }

      if (!res.ok) {
        if (res.status === 401 && isLineSessionExpiredPayload(data)) {
          onSessionExpired?.();
          return;
        }
        if (isCalendarSlotConflictApiResponse(res.status, data)) {
          window.alert(CALENDAR_SLOT_CONFLICT_MESSAGE);
          setFeedback({
            kind: "err",
            text: "他の方が先にこの空き枠を使いました。日付を選び直してください。",
          });
          return;
        }
        /**
         * 移動先には書けたが移動元を戻せなかったとき、サーバは
         * レコードIDと日付を名指しした案内を返す。**そのまま出す**。
         * 要約すると @pocket で直す対象が分からなくなる
         */
        setFeedback({
          kind: "err",
          text:
            data.error?.trim() ||
            `工事日の変更に失敗しました（HTTP ${res.status}）。しばらくしてから再度お試しください。`,
        });
        if (data.constructionSaved) {
          // 片側は書けている。カレンダーを最新にしてから読ませる
          try {
            await onSaved(null);
          } catch {
            /* 表示はエラーを優先 */
          }
        }
        return;
      }

      setConfirming(false);
      setOpen(false);
      reset();
      try {
        await onSaved(null);
      } catch (e) {
        setFeedback({ kind: "err", text: calendarSubmitCatchMessage(e) });
        return;
      }
      setFeedback({
        kind: "ok",
        text:
          data.movedTo === "new"
            ? `${formatDisplayYmd(targetDayKey)} に新しいレコードを作成しました。元の枠は空き枠に戻しています。`
            : `${formatDisplayYmd(targetDayKey)} の空き枠へ移動しました。元の枠は空き枠に戻しています。`,
      });
    } catch (e) {
      setFeedback({ kind: "err", text: calendarSubmitCatchMessage(e) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border-t border-slate-100 px-4 pb-4 pt-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-semibold text-slate-800">
          工事日:{" "}
          <span className="font-bold text-slate-900">
            {formatDisplayYmd(sourceDayKey) || sourceDayKey || "未設定"}
          </span>
        </p>
        {!open ? (
          <button
            type="button"
            className="min-h-[44px] shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-700 shadow-sm ring-1 ring-slate-100 transition active:scale-[0.99] disabled:opacity-50"
            disabled={!canOpen || submitting}
            onClick={() => {
              reset();
              setFeedback(null);
              setOpen(true);
            }}
          >
            工事日を変更
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3">
          <p className="mb-3 text-[12px] leading-relaxed text-slate-600">
            移動先の日付を選び、その日の空き枠を選びます。空き枠が無ければ新しいレコードを作成します。
            <span className="font-semibold text-slate-800">
              元の枠は削除せず、空き枠として残します。
            </span>
          </p>

          <label className="block">
            <span className="mb-1 block text-[12px] font-bold text-slate-700">
              移動先の日付{" "}
              <span className="font-semibold text-red-600">必須</span>
              <span className="mt-0.5 block text-[11px] font-normal leading-snug text-slate-500">
                別の月を選ぶこともできます
              </span>
            </span>
            <div className="construction-schedule-date-field">
              <input
                type="date"
                className="calendar-date-input"
                value={targetDayKey}
                disabled={submitting}
                onChange={(e) => {
                  setTargetDayKey(e.target.value);
                  // 別の日の枠を掴んだままにしない
                  setSelectedSlotId("");
                }}
              />
            </div>
          </label>
          {sameDay ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900 ring-1 ring-amber-100">
              現在の工事日と同じです。別の日を選んでください。
            </p>
          ) : null}

          {targetDayKey && !sameDay ? (
            <div className="mt-3">
              <span className="mb-1 block text-[12px] font-bold text-slate-700">
                移動先の空き枠
                <span className="mt-0.5 block text-[11px] font-normal leading-snug text-slate-500">
                  施工会社が違う枠へも移せます（施工会社も書き換わります）
                </span>
              </span>
              {slotsLoading ? (
                <p className="text-[12px] text-slate-500">
                  移動先の月を読み込み中…
                </p>
              ) : slotsError ? (
                <p className="text-[12px] font-semibold text-red-700">
                  {slotsError}
                </p>
              ) : (
                <select
                  className={INPUT_CLASS}
                  value={selectedSlotId}
                  disabled={submitting}
                  onChange={(e) => setSelectedSlotId(e.target.value)}
                >
                  <option value="">
                    {slots.length === 0
                      ? "この日に空き枠はありません（新規作成）"
                      : "空き枠を使わず新規作成する"}
                  </option>
                  {slots.map((slot) => (
                    <option key={slot.recordId} value={slot.recordId}>
                      空き枠（施工会社: {slot.contractorName || "未設定"}）
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : null}

          {handlerFromStaff ? (
            <ConstructionHandlerStaffSelect
              submitting={submitting}
              canSubmit={canOpen}
              handlerListStatus={handlerListStatus}
              handlerListError={handlerListError}
              handlerRows={handlerRows}
              selectedHandlerStaffId={selectedHandlerStaffId}
              setSelectedHandlerStaffId={setSelectedHandlerStaffId}
              inputId={`construction-handler-move-${recordId || "unknown"}`}
            />
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="min-h-[44px] rounded-xl border border-slate-200 bg-white py-2.5 text-[13px] font-bold text-slate-700 shadow-sm ring-1 ring-slate-100 transition active:scale-[0.99] disabled:opacity-50"
              disabled={submitting}
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="min-h-[44px] rounded-xl bg-slate-800 py-2.5 text-[13px] font-bold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50"
              disabled={submitting || !canConfirm || slotsLoading}
              onClick={() => setConfirming(true)}
            >
              内容を確認する
            </button>
          </div>
        </div>
      ) : null}

      {feedback ? (
        <p
          className={`mt-3 whitespace-pre-wrap text-[13px] font-semibold leading-relaxed ${
            feedback.kind === "ok" ? "text-emerald-800" : "text-red-700"
          }`}
          role={feedback.kind === "err" ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      ) : null}

      <CalendarMoveCaseConfirmDialog
        open={confirming}
        input={confirmInput}
        busy={submitting}
        onConfirm={() => void handleMove()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

/**
 * 移動の確認。元に戻せない操作なので、実行される内容を具体的に並べる。
 * Esc はキャンセル扱い（誤って実行されないようにする）。
 */
export function CalendarMoveCaseConfirmDialog({
  open,
  input,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  input: MoveCaseConfirmInput;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    firstButtonRef.current?.focus();
    const restoreTo = restoreFocusRef.current;
    return () => {
      restoreTo?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (!busy) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  /** ダイアログの外へフォーカスが出ないようにする（簡易トラップ） */
  const onPanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
      return;
    }
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) return null;

  const subject = buildMoveCaseConfirmSubject(input);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 sm:items-center">
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="calendar-move-case-confirm-title"
        className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-4 shadow-xl ring-1 ring-slate-200"
        onKeyDown={onPanelKeyDown}
      >
        <p
          id="calendar-move-case-confirm-title"
          className="text-[15px] font-bold leading-relaxed text-slate-900"
        >
          {buildMoveCaseConfirmTitle(input)}
        </p>
        {subject ? (
          <p className="mt-2 text-[13px] font-semibold text-slate-800">
            {subject}
          </p>
        ) : null}

        <p className="mt-3 text-[12px] font-bold text-slate-700">
          実行される内容
        </p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-slate-600">
          {buildMoveCaseConfirmLines(input).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-semibold leading-relaxed text-amber-900 ring-1 ring-amber-100">
          ⚠ {MOVE_CASE_CONFIRM_WARNING}
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <button
            ref={firstButtonRef}
            type="button"
            className={`${DIALOG_BUTTON_CLASS} bg-[#06C755] text-white`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "移動中…" : moveCaseConfirmActionLabel(input)}
          </button>
          <button
            type="button"
            className={`${DIALOG_BUTTON_CLASS} border border-slate-300 bg-white text-slate-700`}
            disabled={busy}
            onClick={onCancel}
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
