"use client";

import { useEffect, useMemo, useState } from "react";

import { LiffCard } from "@/components/liff-chrome";
import { isMeetingScheduleSetCreatedStatus } from "@/lib/meeting-schedule-shared";
import type { MeetingScheduleStatusUpdateInput } from "@/lib/meeting-schedule-status-update";
import type { MeetingScheduleItem } from "@/lib/meeting-schedule-types";

type Props = {
  item: MeetingScheduleItem;
  staffName: string;
  statusOptions?: string[];
  statusEditable?: boolean;
  closeTypeOptions?: string[];
  meetingPlaceOptions?: string[];
  statusUpdating?: boolean;
  onStatusChange?: (
    recordId: string,
    update: MeetingScheduleStatusUpdateInput,
  ) => void;
};

function mergeSelectOptions(options: string[], current: string): string[] {
  const trimmed = current.trim();
  if (!trimmed || options.includes(trimmed)) return options;
  return [...options, trimmed];
}

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] text-slate-900 shadow-sm disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

export function MeetingScheduleItemCard({
  item,
  staffName,
  statusOptions = [],
  statusEditable = false,
  closeTypeOptions = [],
  meetingPlaceOptions = [],
  statusUpdating = false,
  onStatusChange,
}: Props) {
  const [draftStatus, setDraftStatus] = useState(item.estimateStatus);
  const [meetingDate, setMeetingDate] = useState(item.firstMeetingDateYmd);
  const [closeType, setCloseType] = useState(item.closeType);
  const [meetingPlace, setMeetingPlace] = useState(item.meetingPlace);

  useEffect(() => {
    setDraftStatus(item.estimateStatus);
    setMeetingDate(item.firstMeetingDateYmd);
    setCloseType(item.closeType);
    setMeetingPlace(item.meetingPlace);
  }, [
    item.estimateStatus,
    item.firstMeetingDateYmd,
    item.closeType,
    item.meetingPlace,
    item.recordId,
  ]);

  const selectOptions = useMemo(
    () => mergeSelectOptions(statusOptions, item.estimateStatus),
    [statusOptions, item.estimateStatus],
  );
  const closeOptions = useMemo(
    () => mergeSelectOptions(closeTypeOptions, closeType),
    [closeTypeOptions, closeType],
  );
  const placeOptions = useMemo(
    () => mergeSelectOptions(meetingPlaceOptions, meetingPlace),
    [meetingPlaceOptions, meetingPlace],
  );

  const canEditStatus =
    statusEditable && selectOptions.length > 0 && Boolean(onStatusChange);
  const needsSetCreatedFields = isMeetingScheduleSetCreatedStatus(draftStatus);
  const showSetCreatedForm = canEditStatus && needsSetCreatedFields;
  const statusDirty = draftStatus !== item.estimateStatus;
  const setCreatedDirty =
    meetingDate !== item.firstMeetingDateYmd ||
    closeType !== item.closeType ||
    meetingPlace !== item.meetingPlace;
  const canSaveSetCreated =
    showSetCreatedForm && (statusDirty || setCreatedDirty) && !statusUpdating;

  const handleStatusSelect = (nextStatus: string) => {
    setDraftStatus(nextStatus);
    if (!isMeetingScheduleSetCreatedStatus(nextStatus)) {
      onStatusChange?.(item.recordId, { status: nextStatus });
    }
  };

  const handleSaveSetCreated = () => {
    onStatusChange?.(item.recordId, {
      status: draftStatus,
      meetingDate,
      closeType,
      meetingPlace,
    });
  };

  return (
    <LiffCard>
      <div className="flex items-start gap-3 px-4 py-4">
        <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-sky-50 py-2 dark:bg-sky-950/40">
          <span className="text-[11px] font-medium text-sky-700 dark:text-sky-300">
            開始
          </span>
          <span className="text-[18px] font-black tabular-nums leading-none text-sky-900 dark:text-sky-100">
            {item.meetingTime}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-bold leading-snug text-slate-900 dark:text-white">
            {item.customerName}
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
            {!canEditStatus && item.estimateStatus ? (
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
              <select
                className={inputClass}
                value={draftStatus}
                disabled={statusUpdating}
                onChange={(e) => handleStatusSelect(e.target.value)}
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

          {showSetCreatedForm ? (
            <div className="mt-3 space-y-3 rounded-xl border border-sky-100 bg-sky-50/60 p-3 dark:border-sky-900/50 dark:bg-sky-950/20">
              <p className="text-[12px] font-semibold text-sky-800 dark:text-sky-200">
                商談セット作成済みの入力項目
              </p>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                  初回商談実施日
                </span>
                <input
                  type="date"
                  className={`${inputClass} calendar-date-input`}
                  value={meetingDate}
                  disabled={statusUpdating}
                  onChange={(e) => setMeetingDate(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                  片クロor両クロ
                </span>
                <select
                  className={inputClass}
                  value={closeType}
                  disabled={statusUpdating}
                  onChange={(e) => setCloseType(e.target.value)}
                >
                  <option value="">選択してください</option>
                  {closeOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                  商談場所
                </span>
                <select
                  className={inputClass}
                  value={meetingPlace}
                  disabled={statusUpdating}
                  onChange={(e) => setMeetingPlace(e.target.value)}
                >
                  <option value="">選択してください</option>
                  {placeOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!canSaveSetCreated}
                onClick={handleSaveSetCreated}
                className="w-full rounded-xl bg-sky-600 px-4 py-2.5 text-[14px] font-semibold text-white disabled:opacity-50 dark:bg-sky-500"
              >
                {statusUpdating ? "保存中…" : "保存"}
              </button>
            </div>
          ) : null}

          {!canEditStatus && item.meetingPlace ? (
            <p className="mt-2 text-[13px] text-slate-600 dark:text-slate-400">
              商談場所: {item.meetingPlace}
            </p>
          ) : null}
          {!canEditStatus && item.closeType ? (
            <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">
              片クロor両クロ: {item.closeType}
            </p>
          ) : null}
          {!canEditStatus && item.firstMeetingDateYmd ? (
            <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">
              初回商談実施日: {item.firstMeetingDateYmd}
            </p>
          ) : null}
          {item.apPerson && item.apPerson !== staffName ? (
            <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-500">
              AP: {item.apPerson}
            </p>
          ) : null}
        </div>
      </div>
    </LiffCard>
  );
}
