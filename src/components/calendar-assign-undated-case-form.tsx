"use client";

import { useCallback, useMemo, useState } from "react";

import { CalendarEmptySlotConfirmDialog } from "@/components/calendar-empty-slot-confirm-dialog";
import {
  UndatedCasePicker,
  undatedCaseOptionLabel,
} from "@/components/undated-case-picker";
import { useConstructionContractorOptions } from "@/hooks/use-construction-contractor-options";
import { useUndatedConstructionCases } from "@/hooks/use-undated-construction-cases";
import type {
  CalendarEmptySlotMatch,
  CalendarEmptySlotMatchPayload,
  CalendarRecordMonthPatch,
  UndatedConstructionCase,
} from "@/lib/calendar-api-types";
import {
  buildAssignUndatedCaseRequest,
  formatMissingFieldsMessage,
  missingAssignUndatedCaseFields,
  type AssignUndatedCaseChoice,
  type AssignUndatedCaseValues,
} from "@/lib/calendar-assign-undated-case-request";
import {
  calendarSubmitCatchMessage,
  idTokenForConstructionSubmit,
} from "@/lib/calendar-submit-client";
import {
  CALENDAR_SLOT_CONFLICT_MESSAGE,
  isCalendarSlotConflictApiResponse,
} from "@/lib/calendar-slot-verify-client";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";
import { mergeStaffNameOptions } from "@/lib/staff-name-options";

/**
 * 新規登録の「未定案件を割り当て」タブ（タスクS）。
 *
 * 既存の未定案件を選び、施工予定日と施工会社を直接入力して登録する。
 * 同じ日・同じ施工会社の空き枠があれば確認画面を出し、
 *
 *  - 使う   → 既存の /api/calendar/assign-case-to-slot（空き枠を削除）
 *  - 使わない → /api/calendar/schedule-undated-case（空き枠に触らない）
 *
 * のどちらへ送るかを利用者に選ばせる。空き枠が無ければ確認せず後者を使う。
 */

const SELECT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200";
const INVALID_CLASS = "border-red-400 ring-2 ring-red-200";

type SubmitResponse = {
  error?: string;
  customerInfoSynced?: boolean;
  constructionSaved?: boolean;
  calendarPatch?: CalendarRecordMonthPatch;
  slotConflict?: boolean;
};

async function parseJsonBody(res: Response): Promise<SubmitResponse> {
  const raw = await res.text();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as SubmitResponse;
  } catch {
    return {};
  }
}

export function CalendarAssignUndatedCaseForm({
  idToken,
  active,
  viewYear,
  viewMonth,
  onSaved,
  onSessionExpired,
}: {
  idToken: string | null;
  /** タブが選ばれているとき true。false の間は一覧を取りに行かない */
  active: boolean;
  viewYear: number;
  viewMonth: number;
  onSaved: (patch?: CalendarRecordMonthPatch | null) => Promise<void>;
  onSessionExpired?: () => void;
}) {
  const [selectedCase, setSelectedCase] =
    useState<UndatedConstructionCase | null>(null);
  const [caseSearchInput, setCaseSearchInput] = useState("");
  const [scheduledStartDate, setScheduledStartDate] = useState("");
  const [contractor, setContractor] = useState("");
  const [invalidKeys, setInvalidKeys] = useState<readonly string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const [pendingSlot, setPendingSlot] = useState<CalendarEmptySlotMatch | null>(
    null,
  );

  const cases = useUndatedConstructionCases(idToken, active, onSessionExpired);
  const contractorOptions = useConstructionContractorOptions(idToken, active);

  const contractorSelectOptions = useMemo(
    () => mergeStaffNameOptions(contractorOptions.options, contractor),
    [contractorOptions.options, contractor],
  );

  const canSubmit = Boolean(idToken);
  const busy = submitting;

  const resetAfterSave = useCallback(() => {
    setSelectedCase(null);
    setCaseSearchInput("");
    setScheduledStartDate("");
    setContractor("");
    setInvalidKeys([]);
    setPendingSlot(null);
  }, []);

  const values: AssignUndatedCaseValues = {
    caseRecordId: selectedCase?.recordId ?? "",
    scheduledStartDate,
    contractor,
  };

  /** 送信結果の共通処理。成功なら true */
  async function applyResult(
    res: Response,
    data: SubmitResponse,
    okText: (synced: boolean) => string,
    failVerb: string,
  ): Promise<boolean> {
    if (!res.ok) {
      if (res.status === 401 && isLineSessionExpiredPayload(data)) {
        onSessionExpired?.();
        return false;
      }
      if (isCalendarSlotConflictApiResponse(res.status, data)) {
        window.alert(CALENDAR_SLOT_CONFLICT_MESSAGE);
        setFeedback({
          kind: "err",
          text: "他の方が先にこの空き枠を使いました。もう一度お試しください。",
        });
        return false;
      }
      if (data.constructionSaved) {
        resetAfterSave();
        try {
          await onSaved(data.calendarPatch ?? null);
        } catch {
          /* 保存済みのため UI はエラー表示を優先 */
        }
      }
      const gatewayTimeout =
        res.status === 504 ||
        res.status === 408 ||
        (res.status === 502 && !data.error?.trim() && !data.constructionSaved);
      setFeedback({
        kind: "err",
        text:
          data.error?.trim() ||
          (gatewayTimeout
            ? "処理がタイムアウトしたか、サーバーが応答を返せませんでした。工事アプリに反映されている可能性があります。カレンダーを更新して確認してください。"
            : data.constructionSaved
              ? "工事アプリへの保存は完了しましたが、後続処理に失敗しました。"
              : `${failVerb}に失敗しました（HTTP ${res.status}）。しばらくしてから再度お試しください。`),
      });
      return false;
    }

    resetAfterSave();
    try {
      await onSaved(data.calendarPatch ?? null);
    } catch (e) {
      setFeedback({ kind: "err", text: calendarSubmitCatchMessage(e) });
      return true;
    }
    setFeedback({
      kind: "ok",
      text: okText(Boolean(data.customerInfoSynced)),
    });
    return true;
  }

  /**
   * 3択（または空き枠なし）に応じて送信先を決めて送る。
   * どちらの API を叩くかの判断は純粋関数に寄せてある。
   */
  async function send(
    token: string,
    choice: AssignUndatedCaseChoice,
    slot: CalendarEmptySlotMatch | null,
  ) {
    const req = buildAssignUndatedCaseRequest({
      choice,
      values,
      slot,
      viewYear,
      viewMonth,
    });
    if (!req) return;

    const res = await fetch(req.path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(req.body),
    });
    const data = await parseJsonBody(res);
    await applyResult(
      res,
      data,
      (synced) =>
        req.consumesSlot
          ? synced
            ? "空き枠に割り当てました。カレンダーに反映し、お客様情報アプリの施工予定日も更新しました。"
            : "空き枠に割り当てました。カレンダーに反映済みです。"
          : synced
            ? "登録しました。カレンダーに反映し、お客様情報アプリの施工予定日も更新しました。"
            : "登録しました。カレンダーに反映済みです。",
      req.consumesSlot ? "割り当て" : "登録",
    );
  }

  async function handleSubmit() {
    const missing = missingAssignUndatedCaseFields(values);
    if (missing.length > 0) {
      setInvalidKeys(missing.map((m) => m.key));
      setFeedback({
        kind: "err",
        text: formatMissingFieldsMessage(missing),
      });
      return;
    }
    setInvalidKeys([]);

    setSubmitting(true);
    setFeedback(null);
    try {
      const token = await idTokenForConstructionSubmit(
        idToken,
        onSessionExpired,
      );
      if (!token) return;

      // 同じ日・同じ施工会社の空き枠を探す。取得に失敗しても登録は続ける
      // （空き枠を使わずに登録するのと同じ結果になり、枠は消えない）
      let slot: CalendarEmptySlotMatch | null = null;
      try {
        const params = new URLSearchParams({
          dayKey: scheduledStartDate.trim(),
          contractor: contractor.trim(),
        });
        const res = await fetch(
          `/api/calendar/empty-slots-for-day?${params.toString()}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data = (await res.json()) as CalendarEmptySlotMatchPayload;
        if (res.status === 401 && isLineSessionExpiredPayload(data)) {
          onSessionExpired?.();
          return;
        }
        if (res.ok) slot = data.slot ?? null;
      } catch {
        /* 空き枠を確認できないときは確認画面を出さずに登録する */
      }

      if (slot) {
        // 確認画面へ。ここでは何も書き込まない
        setPendingSlot(slot);
        return;
      }

      // 空き枠が無いときは確認せず、そのまま「使わずに登録」と同じ処理
      await send(token, "skip-slot", null);
    } catch (e) {
      setFeedback({ kind: "err", text: calendarSubmitCatchMessage(e) });
    } finally {
      setSubmitting(false);
    }
  }

  /** 確認画面の3択。キャンセルは何も書き込まずに閉じるだけ */
  async function handleDialogChoice(choice: AssignUndatedCaseChoice) {
    const slot = pendingSlot;
    if (choice === "cancel" || !slot) {
      setPendingSlot(null);
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const token = await idTokenForConstructionSubmit(
        idToken,
        onSessionExpired,
      );
      if (!token) return;
      await send(token, choice, slot);
    } catch (e) {
      setFeedback({ kind: "err", text: calendarSubmitCatchMessage(e) });
    } finally {
      setSubmitting(false);
      setPendingSlot(null);
    }
  }

  const invalid = (key: string) => invalidKeys.includes(key);

  return (
    <div>
      <p className="mb-3 text-[12px] leading-relaxed text-slate-600">
        工事日未定の既存案件に施工予定日を設定します。案件のT番号はそのまま維持されます。
        同じ日・同じ施工会社の空き枠があるときは、その枠を使うかどうかを確認します。
      </p>

      <div className={invalid("case") ? "rounded-xl ring-2 ring-red-200" : ""}>
        <UndatedCasePicker
          state={cases}
          disabled={submitting || !canSubmit}
          searchInput={caseSearchInput}
          onSearchInputChange={(v) => {
            setCaseSearchInput(v);
            setSelectedCase(null);
          }}
          selectedRecordId={selectedCase?.recordId ?? ""}
          onSelectCase={(c) => {
            setSelectedCase(c);
            setCaseSearchInput(undatedCaseOptionLabel(c));
          }}
          onClearSelection={() => {
            setSelectedCase(null);
            setCaseSearchInput("");
          }}
        />
      </div>

      <label className="mt-3 block">
        <span className="mb-1 block text-[12px] font-bold text-slate-700">
          施工予定日 <span className="font-semibold text-red-600">必須</span>
        </span>
        <div className="construction-schedule-date-field">
          <input
            type="date"
            className={`calendar-date-input${
              invalid("scheduledStartDate") ? ` ${INVALID_CLASS}` : ""
            }`}
            value={scheduledStartDate}
            disabled={submitting || !canSubmit}
            onChange={(e) => setScheduledStartDate(e.target.value)}
          />
        </div>
      </label>

      <label className="mt-3 block">
        <span className="mb-1 block text-[12px] font-bold text-slate-700">
          施工会社 <span className="font-semibold text-red-600">必須</span>
        </span>
        <select
          className={`${SELECT_CLASS}${
            invalid("contractor") ? ` ${INVALID_CLASS}` : ""
          }`}
          value={contractor}
          disabled={submitting || !canSubmit || contractorOptions.loading}
          onChange={(e) => setContractor(e.target.value)}
        >
          <option value="">
            {contractorOptions.loading
              ? "一覧を読み込み中…"
              : contractorOptions.configured
                ? "選択してください"
                : "一覧を取得できません"}
          </option>
          {contractorSelectOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          空き枠との照合に使うため、この画面では必須です。
        </p>
      </label>

      {!idToken ? (
        <p className="mt-3 text-[12px] font-semibold text-amber-800">
          ログイン情報がありません。この画面からは登録できません。
        </p>
      ) : null}

      <button
        type="button"
        className="mt-4 min-h-[48px] w-full rounded-xl bg-slate-800 py-3 text-[14px] font-bold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50"
        disabled={submitting || !canSubmit}
        onClick={() => void handleSubmit()}
      >
        {submitting ? "登録中…" : "登録してカレンダーを更新"}
      </button>

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

      <CalendarEmptySlotConfirmDialog
        open={Boolean(pendingSlot)}
        dayKey={pendingSlot?.dayKey ?? ""}
        contractorName={pendingSlot?.contractorName ?? contractor}
        busy={busy}
        onUseSlot={() => void handleDialogChoice("use-slot")}
        onSkipSlot={() => void handleDialogChoice("skip-slot")}
        onCancel={() => void handleDialogChoice("cancel")}
      />
    </div>
  );
}
