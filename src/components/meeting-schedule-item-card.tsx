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
import {
  MeetingScheduleNegotiationFields,
  MeetingScheduleSaveBar,
  dateTimeInputClass,
  inputClass,
  readOnlyNoteClass,
  readOnlyValueClass,
} from "@/components/meeting-schedule-status-fields";
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

/** 誤タップ防止で編集不可にした項目の補足文言 */
const lockedFieldNote = "この項目は @pocket 側で変更してください";

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

  /**
   * JSX から読む入力値。付随項目（初回商談実施日・返待ち回答日・商談ステータス）は
   * MeetingScheduleNegotiationFields が values から読むので、ここでは取らない
   */
  const draftStatus = draft.estimateStatus;
  const scheduledYmd = draft.scheduledYmd;
  const scheduledTime = draft.scheduledTime;
  const closeType = draft.closeType;
  const meetingPlace = draft.meetingPlace;
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

          <MeetingScheduleNegotiationFields
            values={draft}
            server={server}
            saving={saving}
            showSetCreatedForm={showSetCreatedForm}
            showHenmachiForm={showHenmachiForm}
            canEditNegotiation={canEditNegotiation}
            negotiationOptions={negotiationOptions}
            closeOptions={closeOptions}
            placeOptions={placeOptions}
            lockedInputs={lockedInputs}
            clearFeedback={clearFeedback}
            setNegotiationStatus={setNegotiationStatus}
            setMeetingDate={setMeetingDate}
            setCloseType={setCloseType}
            setMeetingPlace={setMeetingPlace}
            setResponseDate={setResponseDate}
          />

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
      <MeetingScheduleSaveBar
        showSaveBar={showSaveBar}
        canSave={canSave}
        saving={saving}
        saveHint={saveHint}
        dirty={plan.dirty}
        feedback={feedback}
        saveConfirm={saveConfirm}
        confirmingNegotiation={confirmingNegotiation}
        requestSave={requestSave}
        runSave={runSave}
        cancelConfirm={cancelConfirm}
      />

      {mapNav ? (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-800">
          <MapNavigationButton
            pinpointAddress={item.pinpointAddress}
            normalAddress={item.normalAddress}
          />
        </div>
      ) : null}

    </LiffCard>
  );
}
