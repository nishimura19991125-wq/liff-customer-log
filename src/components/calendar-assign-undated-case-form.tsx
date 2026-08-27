"use client";

import { useEffect, useMemo, useState } from "react";

import {
  ConstructionHandlerStaffSelect,
  fetchConstructionHandlerStaffRows,
  type HandlerStaffListStatus,
  type HandlerStaffRow,
} from "@/components/construction-handler-staff-select";
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
  ASSIGN_CUSTOMER_CASE_PATH,
  assignedCaseSuccessMessage,
  type AssignCustomerCaseResponse,
} from "@/lib/calendar-assign-customer-case-client";
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
 * 新規登録の「未定案件を割り当て」タブ（第3段階 3-3 で送信先を変更）。
 *
 *   旧: assign-case-to-slot（空き枠を削除）/ schedule-undated-case
 *   新: /api/calendar/assign-customer-case（3-2 で追加・削除しない）
 *
 * ■ 確認ダイアログをやめた
 * 3択は「空き枠を使う＝削除される」という**取り返しのつかない操作**への
 * 同意を取るためのものだった。新しい経路は空き枠を削除せず、枠のレコードを
 * 案件に変えるだけなので、同意を取る対象が無い。
 *
 * さらに「工事登録アプリに同じ案件が既にあれば空き枠を使わない」判定は
 * サーバ側にあり、画面では事前に分からない。守れるとは限らない選択肢を
 * 見せるより、結果（assignedTo）を後から伝えるほうが正確になる。
 *
 * ■ 工事対応者
 * 新しい経路では必須（fill-empty-slot と同じ扱い）。旧経路は書いていな
 * かったので、この画面にも入力欄が要る。
 */

const SELECT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200";
const INVALID_CLASS = "border-red-400 ring-2 ring-red-200";

type MissingKey = "case" | "scheduledStartDate" | "contractor" | "handler";

async function parseJsonBody(
  res: Response,
): Promise<AssignCustomerCaseResponse> {
  const raw = await res.text();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as AssignCustomerCaseResponse;
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
  constructionHandlerUsesStaffDirectory,
}: {
  idToken: string | null;
  /** タブが選ばれているとき true。false の間は一覧を取りに行かない */
  active: boolean;
  viewYear: number;
  viewMonth: number;
  onSaved: (patch?: CalendarRecordMonthPatch | null) => Promise<void>;
  onSessionExpired?: () => void;
  /** undefined: 工事対応者なし。true: スタッフ名簿。false: 設定不足 */
  constructionHandlerUsesStaffDirectory?: boolean;
}) {
  const [selectedCase, setSelectedCase] =
    useState<UndatedConstructionCase | null>(null);
  const [caseSearchInput, setCaseSearchInput] = useState("");
  const [scheduledStartDate, setScheduledStartDate] = useState("");
  const [contractor, setContractor] = useState("");
  const [selectedHandlerStaffId, setSelectedHandlerStaffId] = useState("");
  const [handlerRows, setHandlerRows] = useState<HandlerStaffRow[]>([]);
  const [handlerListStatus, setHandlerListStatus] =
    useState<HandlerStaffListStatus>("idle");
  const [handlerListError, setHandlerListError] = useState("");
  const [invalidKeys, setInvalidKeys] = useState<readonly string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const cases = useUndatedConstructionCases(idToken, active, onSessionExpired);
  const contractorOptions = useConstructionContractorOptions(idToken, active);

  const handlerFromStaff = constructionHandlerUsesStaffDirectory === true;
  const handlerMisconfigured = constructionHandlerUsesStaffDirectory === false;

  const contractorSelectOptions = useMemo(
    () => mergeStaffNameOptions(contractorOptions.options, contractor),
    [contractorOptions.options, contractor],
  );

  const canSubmit = Boolean(idToken);

  useEffect(() => {
    if (!active || !idToken || !handlerFromStaff) {
      if (!active) {
        setSelectedHandlerStaffId("");
        setHandlerRows([]);
        setHandlerListStatus("idle");
        setHandlerListError("");
      }
      return;
    }
    let cancelled = false;
    void (async () => {
      setHandlerListStatus("loading");
      setHandlerListError("");
      const result = await fetchConstructionHandlerStaffRows(idToken);
      if (cancelled) return;
      if (!result.ok) {
        if (result.sessionExpired) onSessionExpired?.();
        setHandlerListStatus("err");
        setHandlerListError(result.error);
        return;
      }
      setHandlerRows(result.rows);
      setHandlerListStatus("ok");
    })();
    return () => {
      cancelled = true;
    };
  }, [active, idToken, handlerFromStaff, onSessionExpired]);

  function resetAfterSave() {
    setSelectedCase(null);
    setCaseSearchInput("");
    setScheduledStartDate("");
    setContractor("");
    setSelectedHandlerStaffId("");
    setInvalidKeys([]);
  }

  /** 未入力の必須項目。空配列なら送信してよい */
  function missingFields(): Array<{ key: MissingKey; label: string }> {
    const missing: Array<{ key: MissingKey; label: string }> = [];
    if (!selectedCase) missing.push({ key: "case", label: "工事日未定案件" });
    if (!scheduledStartDate.trim()) {
      missing.push({ key: "scheduledStartDate", label: "施工予定日" });
    }
    // 空き枠との照合に使うため、この導線では必須
    if (!contractor.trim()) {
      missing.push({ key: "contractor", label: "施工会社" });
    }
    if (handlerFromStaff && !selectedHandlerStaffId.trim()) {
      missing.push({ key: "handler", label: "工事対応者" });
    }
    return missing;
  }

  async function handleSubmit() {
    if (handlerMisconfigured) return;

    const missing = missingFields();
    if (missing.length > 0) {
      setInvalidKeys(missing.map((m) => m.key));
      setFeedback({
        kind: "err",
        text: `未入力の必須項目があります: ${missing
          .map((m) => m.label)
          .join("、")}`,
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

      /**
       * 同じ日・同じ施工会社の空き枠を探す。取得に失敗しても登録は続ける
       * （空き枠を渡さないだけで、案件は登録される）。
       * 見つかっても確認はしない。使うかどうかの最終判断はサーバ側で、
       * 既存の工事レコードがあれば枠は使われずに残る
       */
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
        /* 空き枠を確認できないときは枠なしとして登録する */
      }

      const res = await fetch(ASSIGN_CUSTOMER_CASE_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          customerInfoRecordId: selectedCase!.customerInfoRecordId,
          scheduledStartDate: scheduledStartDate.trim(),
          contractor: contractor.trim(),
          ...(slot?.recordId ? { slotRecordId: slot.recordId } : {}),
          ...(handlerFromStaff
            ? { constructionHandlerStaffRecordId: selectedHandlerStaffId }
            : {}),
          viewYear,
          viewMonth,
        }),
      });
      const data = await parseJsonBody(res);

      if (!res.ok) {
        if (res.status === 401 && isLineSessionExpiredPayload(data)) {
          onSessionExpired?.();
          return;
        }
        if (isCalendarSlotConflictApiResponse(res.status, data)) {
          window.alert(CALENDAR_SLOT_CONFLICT_MESSAGE);
          setFeedback({
            kind: "err",
            text: "他の方が先にこの空き枠を使いました。もう一度お試しください。",
          });
          return;
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
          (res.status === 502 &&
            !data.error?.trim() &&
            !data.constructionSaved);
        setFeedback({
          kind: "err",
          text:
            data.error?.trim() ||
            (gatewayTimeout
              ? "処理がタイムアウトしたか、サーバーが応答を返せませんでした。工事アプリに反映されている可能性があります。カレンダーを更新して確認してください。"
              : data.constructionSaved
                ? "工事アプリへの保存は完了しましたが、後続処理に失敗しました。"
                : `割り当てに失敗しました（HTTP ${res.status}）。しばらくしてから再度お試しください。`),
        });
        return;
      }

      resetAfterSave();
      try {
        await onSaved(data.calendarPatch ?? null);
      } catch (e) {
        setFeedback({ kind: "err", text: calendarSubmitCatchMessage(e) });
        return;
      }
      setFeedback({ kind: "ok", text: assignedCaseSuccessMessage(data) });
    } catch (e) {
      setFeedback({ kind: "err", text: calendarSubmitCatchMessage(e) });
    } finally {
      setSubmitting(false);
    }
  }

  const invalid = (key: string) => invalidKeys.includes(key);

  return (
    <div>
      <p className="mb-3 text-[12px] leading-relaxed text-slate-600">
        お客様情報にある工事日未定の案件に、施工予定日を設定します。
        同じ日・同じ施工会社の空き枠があれば、その枠のレコードをこの案件に変えます（
        <span className="font-semibold text-slate-800">
          空き枠は削除しません
        </span>
        ）。工事登録アプリに同じ案件が既にあるときは、そちらに日付を入れて空き枠は残します。
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
          selectedRecordId={selectedCase?.customerInfoRecordId ?? ""}
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

      {handlerMisconfigured ? (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-semibold leading-relaxed text-amber-900 ring-1 ring-amber-100">
          工事対応者にスタッフ名簿を使うには、STAFF_APP_ID・STAFF_NAME_FIELD_ID・STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID
          の設定が必要です。
        </p>
      ) : null}
      {handlerFromStaff ? (
        <div className={invalid("handler") ? "rounded-xl ring-2 ring-red-200" : ""}>
          <ConstructionHandlerStaffSelect
            submitting={submitting}
            canSubmit={canSubmit}
            handlerListStatus={handlerListStatus}
            handlerListError={handlerListError}
            handlerRows={handlerRows}
            selectedHandlerStaffId={selectedHandlerStaffId}
            setSelectedHandlerStaffId={setSelectedHandlerStaffId}
            inputId="construction-handler-assign-customer-case"
          />
        </div>
      ) : null}

      {!idToken ? (
        <p className="mt-3 text-[12px] font-semibold text-amber-800">
          ログイン情報がありません。この画面からは登録できません。
        </p>
      ) : null}

      <button
        type="button"
        className="mt-4 min-h-[48px] w-full rounded-xl bg-slate-800 py-3 text-[14px] font-bold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50"
        disabled={submitting || !canSubmit || handlerMisconfigured}
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
    </div>
  );
}
