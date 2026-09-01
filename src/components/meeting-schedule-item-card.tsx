"use client";

import { useMemo } from "react";

import { LiffCard } from "@/components/liff-chrome";
import {
  useMeetingScheduleStatusForm,
  type MeetingScheduleCardSaveResult,
} from "@/hooks/use-meeting-schedule-status-form";
import { MapNavigationButton } from "@/components/map-navigation-button";
import { formatCustomerNameForDisplay } from "@/lib/customer-name-display";
import type {
  MeetingScheduleCardPatch,
  MeetingScheduleCardValues,
} from "@/lib/meeting-schedule-card-save";
import { MEETING_SCHEDULE_INPUT_FIELD_LABELS } from "@/lib/meeting-schedule-negotiation-status";
import { formatDisplayYmd } from "@/lib/format-display-ymd";
import { MeetingScheduleNegotiationConfirmDialog } from "@/components/meeting-schedule-negotiation-confirm-dialog";
import type { MeetingScheduleItem } from "@/lib/meeting-schedule-types";
import { buildMapNavigation } from "@/lib/map-navigation";

/**
 * 保存の結果。定義はフック側（use-meeting-schedule-status-form）へ移した。
 * 呼び出し元（app/meeting-schedule/page.tsx）が従来どおり import できるよう
 * ここから再 export する
 */
export type { MeetingScheduleCardSaveResult };

type Props = {
  item: MeetingScheduleItem;
  staffName: string;
  statusOptions?: string[];
  statusEditable?: boolean;
  scheduleEditable?: boolean;
  closeTypeOptions?: string[];
  meetingPlaceOptions?: string[];
  /** この案件を保存中か */
  saving?: boolean;
  onSave?: (
    recordId: string,
    patch: MeetingScheduleCardPatch,
  ) => Promise<MeetingScheduleCardSaveResult>;
};

function mergeSelectOptions(options: string[], current: string): string[] {
  const trimmed = current.trim();
  if (!trimmed || options.includes(trimmed)) return options;
  return [...options, trimmed];
}

/** 入力欄。min-w-0 / max-w-full は親（緑枠など）からのはみ出し防止 */
const inputClass =
  "w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] text-slate-900 shadow-sm disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

/**
 * `type="date"` / `type="time"` は UA 既定の最小幅で width:100% を無視し
 * 親からはみ出す。globals.css の .datetime-input-fit で抑える。
 */
const dateTimeInputClass = `${inputClass} datetime-input-fit`;

/**
 * 保存ボタンの無効時の見た目。
 *
 * 以前は色付きの背景に opacity-50 を重ねるだけで、薄い緑のまま押せそうに見え、
 * 押しても反応しないため「壊れている」と受け取られていた。
 * 背景ごと灰色に落とし、カーソルでも押せないことを示す。
 */
const saveButtonClass =
  "w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-[14px] font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:opacity-100 disabled:shadow-none dark:bg-emerald-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400";

/** 無効な理由。押せる条件が分かるよう、ボタンの下に小さく出す */
const saveHintClass =
  "mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400";

/**
 * 編集不可な項目の値。入力欄と同じ高さ・余白にして行の並びを崩さないが、
 * 枠線と白背景は外し、触れないことが見た目で分かるようにする
 */
const readOnlyValueClass =
  "w-full min-w-0 max-w-full rounded-xl bg-slate-100 px-3 py-2.5 text-[14px] text-slate-900 dark:bg-slate-800 dark:text-white";

/** なぜ触れないのかの補足。値の下に小さく出す */
const readOnlyNoteClass =
  "mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400";

/** 誤タップ防止で編集不可にした項目の補足文言 */
const lockedFieldNote = "この項目は @pocket 側で変更してください";

/**
 * 入力済みで変更できなくなった項目。ラベルは残し、値だけをテキストで見せる。
 * 見積ステータス・商談ステータスの編集不可表示と同じ形にそろえる
 */
function LockedInputRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <p className={readOnlyValueClass}>{value || "未設定"}</p>
      <p className={readOnlyNoteClass}>保存済みのため変更できません</p>
    </div>
  );
}

export function MeetingScheduleItemCard({
  item,
  staffName,
  statusOptions = [],
  statusEditable = false,
  scheduleEditable = false,
  closeTypeOptions = [],
  meetingPlaceOptions = [],
  saving = false,
  onSave,
}: Props) {
  /** @pocket 側の現在値。差分判定の基準 */
  const server: MeetingScheduleCardValues = useMemo(
    () => ({
      estimateStatus: item.estimateStatus,
      scheduledYmd: item.scheduledYmd,
      scheduledTime: item.scheduledTime,
      meetingDate: item.firstMeetingDateYmd,
      closeType: item.closeType,
      meetingPlace: item.meetingPlace,
      responseDate: item.responseDateYmd,
      negotiationStatus: item.negotiationStatus,
    }),
    [
      item.estimateStatus,
      item.scheduledYmd,
      item.scheduledTime,
      item.firstMeetingDateYmd,
      item.closeType,
      item.meetingPlace,
      item.responseDateYmd,
      item.negotiationStatus,
    ],
  );

  const selectOptions = useMemo(
    () => mergeSelectOptions(statusOptions, item.estimateStatus),
    [statusOptions, item.estimateStatus],
  );

  /**
   * 入力・判定・保存はフックが持つ。アポ情報一覧（段階C）でも同じものを使う。
   * ここに条件を書き足さないこと（画面ごとにずれる元になる）
   */
  const form = useMeetingScheduleStatusForm({
    recordId: item.recordId,
    server,
    statusEditable,
    scheduleEditable,
    hasStatusOptions: selectOptions.length > 0,
    saving,
    onSave,
  });
  const {
    values: draft,
    setters,
    clearFeedback,
    canEditStatus,
    canEditSchedule,
    canEditStatusDetails,
    showStatusText,
    showScheduleText,
    showSaveBar,
    showSetCreatedForm,
    showHenmachiForm,
    canEditNegotiation,
    negotiationOptions,
    lockedInputs,
    plan,
    canSave,
    saveHint,
    feedback,
    saveConfirm,
    confirmingNegotiation,
    requestSave,
    runSave,
    cancelConfirm,
  } = form;

  /** JSX から読む入力値。名前は切り出し前と同じにして差分を小さく保つ */
  const draftStatus = draft.estimateStatus;
  const scheduledYmd = draft.scheduledYmd;
  const scheduledTime = draft.scheduledTime;
  const meetingDate = draft.meetingDate;
  const closeType = draft.closeType;
  const meetingPlace = draft.meetingPlace;
  const responseDate = draft.responseDate;
  const negotiationStatus = draft.negotiationStatus;
  const {
    setDraftStatus,
    setScheduledYmd,
    setScheduledTime,
    setMeetingDate,
    setCloseType,
    setMeetingPlace,
    setResponseDate,
    setNegotiationStatus,
  } = setters;

  const closeOptions = useMemo(
    () => mergeSelectOptions(closeTypeOptions, closeType),
    [closeTypeOptions, closeType],
  );
  const placeOptions = useMemo(
    () => mergeSelectOptions(meetingPlaceOptions, meetingPlace),
    [meetingPlaceOptions, meetingPlace],
  );

  const displayTime = item.scheduledTime || item.meetingTime;
  const mapNav = buildMapNavigation({
    pinpointAddress: item.pinpointAddress,
    normalAddress: item.normalAddress,
  });

  return (
    <LiffCard>
      <div className="flex items-start gap-3 px-4 py-4">
        <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-sky-50 py-2 dark:bg-sky-950/40">
          <span className="text-[11px] font-medium text-sky-700 dark:text-sky-300">
            開始
          </span>
          <span className="text-[18px] font-black tabular-nums leading-none text-sky-900 dark:text-sky-100">
            {displayTime}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-bold leading-snug text-slate-900 dark:text-white">
            {/* 表示だけ整える。@pocket の値は変更しない */}
            {formatCustomerNameForDisplay(item.customerName)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.city ? (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {item.city}
              </span>
            ) : null}
            {item.apoTypeLabel ? (
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[12px] font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                {item.apoTypeLabel}
              </span>
            ) : null}
            {!canEditStatusDetails && item.estimateStatus ? (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[12px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {item.estimateStatus}
              </span>
            ) : null}
          </div>

          {canEditStatus ? (
            <label className="mt-3 block">
              <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                見積ステータス
              </span>
              {/* 選んだ時点では保存しない。カード下部の「保存」でまとめて送る */}
              <select
                className={inputClass}
                value={draftStatus}
                disabled={saving}
                onChange={(e) => {
                  clearFeedback();
                  setDraftStatus(e.target.value);
                }}
              >
                {!draftStatus ? (
                  <option value="">選択してください</option>
                ) : null}
                {selectOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {/* 編集不可。ラベルは残し、値だけをテキストで見せる */}
          {showStatusText ? (
            <div className="mt-3">
              <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                見積ステータス
              </span>
              <p className={readOnlyValueClass}>
                {item.estimateStatus || "未設定"}
              </p>
              <p className={readOnlyNoteClass}>{lockedFieldNote}</p>
            </div>
          ) : null}

          {canEditSchedule ? (
            <div className="mt-3 space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
              <p className="text-[12px] font-semibold text-emerald-800 dark:text-emerald-200">
                商談・資料送付予定日時
              </p>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                  日付
                </span>
                <input
                  type="date"
                  className={dateTimeInputClass}
                  value={scheduledYmd}
                  disabled={saving}
                  onChange={(e) => {
                    clearFeedback();
                    setScheduledYmd(e.target.value);
                  }}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                  時刻
                </span>
                <input
                  type="time"
                  className={dateTimeInputClass}
                  value={scheduledTime}
                  disabled={saving}
                  onChange={(e) => {
                    clearFeedback();
                    setScheduledTime(e.target.value);
                  }}
                />
              </label>
            </div>
          ) : null}

          {/* 編集不可。緑枠は残さず、日付・時刻を値のテキストで見せる */}
          {showScheduleText ? (
            <div className="mt-3">
              <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                商談・資料送付予定日時
              </span>
              <p className={readOnlyValueClass}>
                {item.scheduledDateLabel || "日付未定"}
                {item.scheduledTime ? ` ${item.scheduledTime}` : ""}
              </p>
              <p className={readOnlyNoteClass}>{lockedFieldNote}</p>
            </div>
          ) : null}

          {showSetCreatedForm ? (
            <div className="mt-3 space-y-3 rounded-xl border border-sky-100 bg-sky-50/60 p-3 dark:border-sky-900/50 dark:bg-sky-950/20">
              <p className="text-[12px] font-semibold text-sky-800 dark:text-sky-200">
                商談セット作成済みの入力項目
              </p>
              {canEditNegotiation ? (
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                    商談ステータス
                  </span>
                  {/* 選んだ時点では保存しない。カード下部の「保存」でまとめて送る */}
                  <select
                    className={inputClass}
                    value={negotiationStatus}
                    disabled={saving}
                    onChange={(e) => {
                      clearFeedback();
                      setNegotiationStatus(e.target.value);
                    }}
                  >
                    {negotiationOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                /* 変更不可の9件と、遷移表に無い値・空欄。見積ステータスと同じ形 */
                <div>
                  <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                    商談ステータス
                  </span>
                  <p className={readOnlyValueClass}>
                    {item.negotiationStatus || "未設定"}
                  </p>
                  <p className={readOnlyNoteClass}>
                    この商談ステータスからは変更できません
                  </p>
                </div>
              )}
              {lockedInputs.meetingDate ? (
                <LockedInputRow
                  label={MEETING_SCHEDULE_INPUT_FIELD_LABELS.meetingDate}
                  value={formatDisplayYmd(server.meetingDate)}
                />
              ) : (
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                    {MEETING_SCHEDULE_INPUT_FIELD_LABELS.meetingDate}
                  </span>
                  <input
                    type="date"
                    className={dateTimeInputClass}
                    value={meetingDate}
                    disabled={saving}
                    onChange={(e) => {
                      clearFeedback();
                      setMeetingDate(e.target.value);
                    }}
                  />
                </label>
              )}
              {lockedInputs.closeType ? (
                <LockedInputRow
                  label={MEETING_SCHEDULE_INPUT_FIELD_LABELS.closeType}
                  value={server.closeType}
                />
              ) : (
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                    {MEETING_SCHEDULE_INPUT_FIELD_LABELS.closeType}
                  </span>
                  <select
                    className={inputClass}
                    value={closeType}
                    disabled={saving}
                    onChange={(e) => {
                      clearFeedback();
                      setCloseType(e.target.value);
                    }}
                  >
                    <option value="">選択してください</option>
                    {closeOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {lockedInputs.meetingPlace ? (
                <LockedInputRow
                  label={MEETING_SCHEDULE_INPUT_FIELD_LABELS.meetingPlace}
                  value={server.meetingPlace}
                />
              ) : (
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                    {MEETING_SCHEDULE_INPUT_FIELD_LABELS.meetingPlace}
                  </span>
                  <select
                    className={inputClass}
                    value={meetingPlace}
                    disabled={saving}
                    onChange={(e) => {
                      clearFeedback();
                      setMeetingPlace(e.target.value);
                    }}
                  >
                    <option value="">選択してください</option>
                    {placeOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          ) : null}

          {showHenmachiForm ? (
            <div className="mt-3 space-y-3 rounded-xl border border-violet-100 bg-violet-50/60 p-3 dark:border-violet-900/50 dark:bg-violet-950/20">
              <p className="text-[12px] font-semibold text-violet-800 dark:text-violet-200">
                返待ちの入力項目
              </p>
              {lockedInputs.responseDate ? (
                <LockedInputRow
                  label={MEETING_SCHEDULE_INPUT_FIELD_LABELS.responseDate}
                  value={formatDisplayYmd(server.responseDate)}
                />
              ) : (
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                    {MEETING_SCHEDULE_INPUT_FIELD_LABELS.responseDate}
                  </span>
                  <input
                    type="date"
                    className={dateTimeInputClass}
                    value={responseDate}
                    disabled={saving}
                    onChange={(e) => {
                      clearFeedback();
                      setResponseDate(e.target.value);
                    }}
                  />
                </label>
              )}
            </div>
          ) : null}

          {!canEditStatusDetails && item.meetingPlace ? (
            <p className="mt-2 text-[13px] text-slate-600 dark:text-slate-400">
              商談場所: {item.meetingPlace}
            </p>
          ) : null}
          {!canEditStatusDetails && item.closeType ? (
            <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">
              片クロor両クロ: {item.closeType}
            </p>
          ) : null}
          {!canEditStatusDetails && item.firstMeetingDateYmd ? (
            <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">
              初回商談実施日: {item.firstMeetingDateYmd}
            </p>
          ) : null}
          {!canEditStatusDetails && item.responseDateYmd ? (
            <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">
              返待ち回答日: {item.responseDateLabel}
            </p>
          ) : null}
          {item.apPerson && item.apPerson !== staffName ? (
            <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-500">
              AP: {item.apPerson}
            </p>
          ) : null}
        </div>
      </div>

      {/*
        保存はカード全体に対する操作。ステータスも日時も含むため、
        緑枠（商談・資料送付予定日時）の外に置いて区切り線で分ける
      */}
      {showSaveBar ? (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-800">
          <button
            type="button"
            disabled={!canSave}
            // 確認が要る変更は、ダイアログで承諾されるまで保存しない（フック側）
            onClick={requestSave}
            className={saveButtonClass}
          >
            {saving ? "保存中…" : "保存"}
          </button>
          {saveHint ? <p className={saveHintClass}>{saveHint}</p> : null}

          {/*
            未保存の案内と保存完了の通知。案件ごとに 1 つ置き、
            要素は出し入れせず読み上げの取りこぼしを防ぐ
          */}
          <p
            role="status"
            aria-live="polite"
            className={`mt-1 text-[12px] font-bold leading-relaxed ${
              plan.dirty
                ? "text-amber-800 dark:text-amber-300"
                : "text-emerald-800 dark:text-emerald-300"
            }`}
          >
            {plan.dirty
              ? "未保存の変更があります"
              : feedback?.kind === "ok"
                ? feedback.message
                : ""}
          </p>

          {feedback?.kind === "error" ? (
            <div
              role="alert"
              aria-live="assertive"
              className="mt-1 rounded-lg border border-red-300 bg-red-50 px-2.5 py-2 text-[12px] font-bold leading-relaxed text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
            >
              {feedback.messages.map((m) => (
                <p key={m}>{m}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {mapNav ? (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-800">
          <MapNavigationButton
            pinpointAddress={item.pinpointAddress}
            normalAddress={item.normalAddress}
          />
        </div>
      ) : null}

      <MeetingScheduleNegotiationConfirmDialog
        open={confirmingNegotiation}
        title={saveConfirm.title}
        message={saveConfirm.blocks.join("\n\n")}
        onConfirm={() => void runSave()}
        onCancel={cancelConfirm}
      />
    </LiffCard>
  );
}
