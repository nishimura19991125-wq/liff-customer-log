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
  MOVE_CONSTRUCTION_CASE_PATH,
  buildMoveCaseConfirmLines,
  buildMoveCaseConfirmSubject,
  buildMoveCaseConfirmTitle,
  moveCaseConfirmActionLabel,
  moveCaseConfirmWarning,
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
import { useConstructionContractorOptions } from "@/hooks/use-construction-contractor-options";
import {
  MOVE_SLOT_CHOICE_NONE,
  buildMoveSlotChoices,
  describeMoveBlockedReason,
  moveBlockedReasonMessage,
  moveSlotChoiceIsNew,
  moveTargetIsSameDay,
  resolveMoveContractorInput,
  slotRecordIdFromChoice,
} from "@/lib/calendar-move-slot-choice";
import {
  contractorNameFromKey,
  emptySlotsFromDayItems,
  monthKeyOf,
  resolveMoveTargetMonthState,
  type LoadedMonthByDay,
} from "@/lib/calendar-move-target-slots";
import {
  DIALOG_BODY_CLASS,
  DIALOG_FOOTER_CLASS,
  DIALOG_BACKDROP_CLASS,
  DIALOG_VIEWPORT_CLASS,
  DIALOG_PANEL_CLASS,
} from "@/lib/dialog-shell";
import { formatDisplayYmd } from "@/lib/format-display-ymd";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";
import { mergeStaffNameOptions } from "@/lib/staff-name-options";

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
 *
 * ■ 枠か新規作成かはラジオで1回選ばせる
 * 以前は「未選択」と「新規作成」が同じ空文字だったため、日付を選んだ
 * 時点で新規作成が選ばれた状態になっていた。元に戻せない操作なので、
 * 枠を使うのか作るのかを明示させる。施工業者の欄も、新規作成を選んだ
 * ときにだけ出す（枠を選んだときは枠の施工会社が使われる）。
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
  onMoved,
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
  /**
   * 移動の即時反映。移動は**2レコード**が変わるので calendarPatch では
   * 表せない。手元の byDay を組み替えてから再取得する
   */
  onMoved?: (move: {
    caseRecordId: string;
    sourceDayKey: string;
    targetDayKey: string;
    movedRecordId: string | null;
    slotRecordId: string | null;
  }) => Promise<void>;
  onSessionExpired?: () => void;
}) {
  const recordId = item.recordId?.trim() ?? "";
  const [open, setOpen] = useState(false);
  const [targetDayKey, setTargetDayKey] = useState("");
  /** 空き枠の recordId / 新しく作成する / 未選択 のいずれか */
  const [slotChoice, setSlotChoice] = useState(MOVE_SLOT_CHOICE_NONE);
  /** 新規作成のときに選ぶ施工業者。空き枠を選んだときは使わない */
  const [newContractor, setNewContractor] = useState("");
  /**
   * 移動元をどうするか（M-4）。**既定は「残す」**。
   * 削除は元に戻せないので、確認画面で明示的に選ばれたときだけ送る
   */
  const [sourceDisposition, setSourceDisposition] = useState<
    "keep" | "delete"
  >("keep");
  const [selectedHandlerStaffId, setSelectedHandlerStaffId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  /**
   * 別の月を選んだときだけ取りにいく。**取れた月の結果だけ**を持つ。
   *
   * ⚠ ここに "loading" のような途中状態を入れて、それをエフェクトの
   *    依存に含めてはいけない。エフェクトが自分の書いた state で再実行され、
   *    走っている fetch を自分でキャンセルして永久に読み込み中になる
   *    （M-3 の不具合）。読み込み中かどうかは
   *    「欲しい月 === 取れた月か」から導く。
   */
  const [loadedMonth, setLoadedMonth] = useState<LoadedMonthByDay | null>(null);
  /** 失敗したときの手動再取得。依存に入れて回す */
  const [reloadNonce, setReloadNonce] = useState(0);

  /**
   * onSessionExpired は呼び出し側がインラインで渡すので毎描画で別物になる。
   * 依存に入れると描画のたびに再取得＝走っている fetch を潰し続ける
   */
  const onSessionExpiredRef = useRef(onSessionExpired);
  useEffect(() => {
    onSessionExpiredRef.current = onSessionExpired;
  }, [onSessionExpired]);

  const sourceContractor = contractorNameFromKey(item.contractorKey);

  const canOpen = Boolean(idToken && recordId && sourceDayKey.trim());

  function reset() {
    setTargetDayKey("");
    setSlotChoice(MOVE_SLOT_CHOICE_NONE);
    setNewContractor("");
    setSourceDisposition("keep");
    setSelectedHandlerStaffId("");
    setConfirming(false);
    setLoadedMonth(null);
  }

  /** 読み込み中／失敗は state に持たず、キー比較から導く（純粋関数） */
  const monthState = resolveMoveTargetMonthState({
    targetDayKey,
    viewYear,
    viewMonth,
    viewByDay: byDay,
    loadedMonth,
  });
  const needsOtherMonth = monthState.needsFetch;
  const otherMonthKey = monthKeyOf(targetDayKey);

  useEffect(() => {
    if (!open || !needsOtherMonth || !idToken || !otherMonthKey) return;

    let cancelled = false;
    void (async () => {
      const [y, m] = otherMonthKey.split("-");
      const qs = new URLSearchParams({
        year: String(Number(y)),
        month: String(Number(m)),
      });
      /** 失敗しても「取れた月」として置く。読み込み中のまま止めない */
      const settle = (
        byDay: Record<string, CalendarMonthApiItem[]>,
        error: string,
      ) => {
        if (cancelled) return;
        setLoadedMonth({ key: otherMonthKey, byDay, error });
      };

      try {
        const res = await fetch(`${calendarApiPath}?${qs}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = (await res.json()) as CalendarApiPayload & {
          error?: string;
        };
        if (res.status === 401 && isLineSessionExpiredPayload(data)) {
          onSessionExpiredRef.current?.();
          settle(
            {},
            "ログインの有効期限が切れました。画面を更新してください。",
          );
          return;
        }
        if (!res.ok) {
          settle(
            {},
            typeof data.error === "string" && data.error.trim()
              ? data.error
              : "移動先の月のカレンダーを取得できませんでした",
          );
          return;
        }
        settle(data.byDay ?? {}, "");
      } catch {
        settle({}, "通信に失敗しました");
      }
    })();

    return () => {
      cancelled = true;
    };
    // onSessionExpired は ref 経由。依存に入れると毎描画で取り直す
  }, [open, needsOtherMonth, otherMonthKey, idToken, calendarApiPath, reloadNonce]);

  const slots = useMemo(
    () =>
      targetDayKey
        ? emptySlotsFromDayItems(monthState.byDay?.[targetDayKey])
        : [],
    [monthState.byDay, targetDayKey],
  );
  const slotsLoading = monthState.loading;
  const slotsError = monthState.error;

  const choices = useMemo(
    () => buildMoveSlotChoices(slots, targetDayKey),
    [slots, targetDayKey],
  );
  const selectedSlotId = slotRecordIdFromChoice(slotChoice);
  const selectedSlot = slots.find((s) => s.recordId === selectedSlotId) ?? null;
  const choosingNew = moveSlotChoiceIsNew(slotChoice);
  const sameDay = moveTargetIsSameDay(targetDayKey, sourceDayKey);
  /** 枠の一覧を出せているか。読めていないうちは新規作成の続きも出さない */
  const slotChoiceVisible =
    Boolean(targetDayKey) && !sameDay && !slotsLoading && !slotsError;

  /**
   * 施工業者の候補は新規登録・未定案件の割り当てと同じフックで取る。
   * active を「新しく作成するを選んでいる間」だけ true にするので、
   * 空き枠を選ぶ通常の移動では**1回も呼ばない**
   */
  const contractorOptions = useConstructionContractorOptions(
    idToken,
    open && choosingNew && !slotsLoading && !slotsError,
  );
  const contractorSelectOptions = useMemo(
    () => mergeStaffNameOptions(contractorOptions.options, newContractor),
    [contractorOptions.options, newContractor],
  );
  const contractorInput = resolveMoveContractorInput({
    slotChoice,
    optionsLoading: contractorOptions.loading,
    optionsConfigured: contractorOptions.configured,
    optionCount: contractorOptions.options.length,
  });

  const confirmInput: MoveCaseConfirmInput = {
    customerName: item.line1?.trim() ?? "",
    tNumber: item.tNumber?.trim() ?? "",
    sourceDayKey,
    targetDayKey,
    sourceContractor,
    targetSlotContractor: selectedSlot ? selectedSlot.contractorName : null,
    // 新規作成のときだけ。枠を選んだ側の分岐には混ぜない
    newRecordContractor: choosingNew ? newContractor.trim() || null : null,
    sourceDisposition,
  };

  const confirmBlockedBy = describeMoveBlockedReason({
    canOpen,
    targetDayKey,
    sourceDayKey,
    slotChoice,
    handlerRequired: handlerFromStaff,
    handlerStaffId: selectedHandlerStaffId,
    contractorRequired: contractorInput.required,
    contractor: newContractor,
  });
  const canConfirm = confirmBlockedBy === null;

  async function handleMove() {
    /**
     * ⚠ **黙って戻らないこと。**
     *
     * ボタンは canConfirm で無効にしてあるので、ここへ来るのは確認画面を
     * 開いたあとに条件が崩れたとき（ログインの期限切れなど）。以前はただ
     * return していたため、押しても「移動中…」にすら変わらず、画面にも
     * サーバのログにも何も残らなかった。原因を誰も追えない。
     */
    if (confirmBlockedBy) {
      setConfirming(false);
      setFeedback({
        kind: "err",
        text: moveBlockedReasonMessage(confirmBlockedBy),
      });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const token = await idTokenForConstructionSubmit(
        idToken,
        onSessionExpired,
      );
      if (!token) {
        // onSessionExpired は呼ばれているが、この画面にも理由を残す
        setFeedback({
          kind: "err",
          text: "ログインの有効期限が切れました。画面を更新してからもう一度お試しください。",
        });
        return;
      }

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
          // 新規作成で選んだ施工業者。枠を選んだときは枠の値が優先される
          ...(choosingNew && newContractor.trim()
            ? { contractor: newContractor.trim() }
            : {}),
          // 既定（残す）では送らない。サーバ側も省略を keep として読む
          ...(sourceDisposition === "delete"
            ? { sourceDisposition: "delete" }
            : {}),
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
      const movedDayKey = targetDayKey;
      const usedSlotId = selectedSlotId;
      reset();
      try {
        /**
         * 再取得だけに任せると、工事レコードのキャッシュ（既定300秒）と
         * 月ペイロードのキャッシュのぶん、押した直後の画面が変わらない。
         * 手元の byDay を先に組み替えて、移動先の日へ移す
         */
        if (onMoved) {
          await onMoved({
            caseRecordId: recordId,
            sourceDayKey,
            targetDayKey: movedDayKey,
            // 空き枠を使ったならその ID、新規作成ならサーバが返した ID
            movedRecordId: data.recordId?.trim() || null,
            slotRecordId: usedSlotId || null,
          });
        } else {
          await onSaved(null);
        }
      } catch (e) {
        setFeedback({ kind: "err", text: calendarSubmitCatchMessage(e) });
        return;
      }
      const movedWhere =
        data.movedTo === "new"
          ? `${formatDisplayYmd(movedDayKey)} に新しいレコードを作成しました。`
          : `${formatDisplayYmd(movedDayKey)} の空き枠へ移動しました。`;
      /**
       * 移動元をどう片づけたかは**サーバの結果で言う**。画面の選択で言うと、
       * 削除を選んだのに判定で見送られた場合に嘘になる
       */
      const sourceWhat = data.sourceDeleted
        ? "元のレコードは削除しました。"
        : "元の枠は空き枠に戻しています。";
      const kept = data.sourceKeptNotice?.trim();
      setFeedback({
        kind: "ok",
        text: `${movedWhere}${sourceWhat}${kept ? `
${kept}` : ""}`,
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
                  setSlotChoice(MOVE_SLOT_CHOICE_NONE);
                  setNewContractor("");
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
                移動先の空き枠{" "}
                <span className="font-semibold text-red-600">必須</span>
                <span className="mt-0.5 block text-[11px] font-normal leading-snug text-slate-500">
                  施工会社が違う枠へも移せます（施工会社も書き換わります）
                </span>
              </span>
              {slotsLoading ? (
                <p className="text-[12px] text-slate-500">
                  移動先の月を読み込み中…
                </p>
              ) : slotsError ? (
                /**
                 * 枠を読めていないまま進ませない。空き枠があるのに
                 * 新規作成すると、その日に枠と案件が並ぶ（この機能が
                 * 直そうとしている状態そのもの）。理由を出して再取得させる
                 */
                <div className="rounded-xl bg-red-50 px-3 py-2 ring-1 ring-red-100">
                  <p
                    className="text-[12px] font-semibold leading-relaxed text-red-700"
                    role="alert"
                  >
                    {slotsError}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-red-700">
                    空き枠を確認できないため、この日には移動できません。
                  </p>
                  <button
                    type="button"
                    className="mt-2 min-h-[44px] rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[12px] font-bold text-red-700 shadow-sm transition active:scale-[0.99] disabled:opacity-50"
                    disabled={submitting}
                    onClick={() => setReloadNonce((n) => n + 1)}
                  >
                    再読み込み
                  </button>
                </div>
              ) : (
                <>
                  {slots.length === 0 ? (
                    <p className="mb-2 text-[12px] leading-relaxed text-slate-500">
                      この日に空き枠はありません。
                    </p>
                  ) : null}
                  <div className="space-y-2" role="radiogroup">
                    {choices.map((choice) => (
                      /**
                       * 2行になるぶん、行そのものを押せる面にする。
                       * label がラジオを包んでいるので、日付でも施工会社でも
                       * どこを押しても選べる（指で狙う的が丸だけにならない）
                       */
                      <label
                        key={choice.value}
                        className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-[14px] text-slate-900 shadow-inner transition ${
                          slotChoice === choice.value
                            ? "border-emerald-300 bg-emerald-50 ring-2 ring-emerald-200"
                            : "border-slate-200 bg-white ring-1 ring-slate-100"
                        }`}
                      >
                        <input
                          type="radio"
                          className="h-5 w-5 shrink-0 accent-emerald-600"
                          name={`calendar-move-slot-${recordId || "unknown"}`}
                          value={choice.value}
                          checked={slotChoice === choice.value}
                          disabled={submitting}
                          onChange={() => {
                            setSlotChoice(choice.value);
                            // 枠を選んだら、新規作成用に選んだ施工業者は持ち越さない
                            if (!choice.isNew) setNewContractor("");
                          }}
                        />
                        <span className="min-w-0 leading-snug">
                          <span className="block font-semibold">
                            {choice.label}
                          </span>
                          {choice.detail ? (
                            <span className="mt-0.5 block text-[12px] font-normal text-slate-600">
                              {choice.detail}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {contractorInput.show && slotChoiceVisible ? (
            <label className="mt-3 block">
              <span className="mb-1 block text-[12px] font-bold text-slate-700">
                施工業者{" "}
                {contractorInput.required ? (
                  <span className="font-semibold text-red-600">必須</span>
                ) : (
                  <span className="font-medium text-slate-500">（任意）</span>
                )}
              </span>
              <select
                className={INPUT_CLASS}
                value={newContractor}
                disabled={submitting || contractorOptions.loading}
                onChange={(e) => setNewContractor(e.target.value)}
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
                {contractorOptions.loading
                  ? "取引先会社一覧を読み込み中…"
                  : contractorOptions.configured
                    ? "取引先会社一覧（会社種別＝施工店・取引状況＝取引中）から選択"
                    : "一覧を取得できないため、選ばずに進むと移動元の施工会社を引き継ぎます。TRADING_PARTNER_APP_ID および取引先列の環境変数を確認してください。"}
              </p>
            </label>
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
              disabled={
                submitting ||
                !canConfirm ||
                slotsLoading ||
                Boolean(slotsError)
              }
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
        sourceDisposition={sourceDisposition}
        onSourceDispositionChange={setSourceDisposition}
        onConfirm={() => void handleMove()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

/**
 * 移動元の扱い。**「残す」を先に置き、既定にする。**
 * 削除は元に戻せないので、並びでも既定でも消す側へ倒さない。
 */
const SOURCE_DISPOSITION_CHOICES: readonly {
  value: "keep" | "delete";
  label: string;
}[] = [
  { value: "keep", label: "空き枠として残す（従来どおり）" },
  { value: "delete", label: "削除する" },
];

/**
 * 移動の確認。元に戻せない操作なので、実行される内容を具体的に並べる。
 * Esc はキャンセル扱い（誤って実行されないようにする）。
 */
export function CalendarMoveCaseConfirmDialog({
  open,
  input,
  busy,
  sourceDisposition,
  onSourceDispositionChange,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  input: MoveCaseConfirmInput;
  busy: boolean;
  sourceDisposition: "keep" | "delete";
  onSourceDispositionChange: (next: "keep" | "delete") => void;
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
  const sourceYmd =
    formatDisplayYmd(input.sourceDayKey) || input.sourceDayKey.trim();

  /**
   * 覆い（backdrop）と位置決め（viewport）を分けてある。
   * 覆いは inset: 0 だけで高さが決まるので潰れず、必ず背後を守る。
   */
  return (
    <div className={DIALOG_BACKDROP_CLASS}>
      {/* 位置決め。高さ（dvh）はここが持つ */}
      <div className={DIALOG_VIEWPORT_CLASS}>
        <div
          ref={panelRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="calendar-move-case-confirm-title"
          className={`${DIALOG_PANEL_CLASS} bg-white shadow-xl ring-1 ring-slate-200`}
          onKeyDown={onPanelKeyDown}
        >
          {/* 中身。ここだけスクロールする */}
          <div className={DIALOG_BODY_CLASS}>
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

            {/**
             * 移動元をどうするか。**箇条書きより先に置く。**
             * この選択が「実行される内容」を書き換えるので、原因が結果より
             * 先に来る順にする
             */}
            <fieldset className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
              <legend className="px-1 text-[12px] font-bold text-slate-700">
                移動元（{sourceYmd}）のレコードをどうしますか？
              </legend>
              <div className="mt-1 space-y-1.5">
                {SOURCE_DISPOSITION_CHOICES.map((choice) => (
                  <label
                    key={choice.value}
                    className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] transition ${
                      sourceDisposition === choice.value
                        ? "bg-white font-semibold text-slate-900 ring-1 ring-slate-300"
                        : "text-slate-700"
                    }`}
                  >
                    <input
                      type="radio"
                      className="h-4 w-4 shrink-0 accent-slate-700"
                      name="calendar-move-source-disposition"
                      value={choice.value}
                      checked={sourceDisposition === choice.value}
                      disabled={busy}
                      onChange={() => onSourceDispositionChange(choice.value)}
                    />
                    <span className="leading-snug">{choice.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <p className="mt-3 text-[12px] font-bold text-slate-700">
              実行される内容
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-slate-600">
              {buildMoveCaseConfirmLines(input).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-semibold leading-relaxed text-amber-900 ring-1 ring-amber-100">
              ⚠ {moveCaseConfirmWarning(input)}
            </p>
          </div>

          {/* 操作。中身がどれだけ長くても必ず見える位置に残す */}
          <div className={`${DIALOG_FOOTER_CLASS} flex flex-col gap-2`}>
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
    </div>
  );
}
