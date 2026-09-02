"use client";

import { useMemo } from "react";

import {
  MeetingScheduleNegotiationFields,
  MeetingScheduleSaveBar,
} from "@/components/meeting-schedule-status-fields";
import {
  useMeetingScheduleStatusForm,
  type MeetingScheduleCardSaveResult,
} from "@/hooks/use-meeting-schedule-status-form";
import { apoListRowToCardValues } from "@/lib/apo-list-card-values";
import type { ApoListRow } from "@/lib/apo-list-types";
import type { MeetingScheduleCardPatch } from "@/lib/meeting-schedule-card-save";

type Props = {
  row: ApoListRow;
  /** @pocket への書き込みが使えるか（payload の statusEditable） */
  statusEditable: boolean;
  closeTypeOptions: string[];
  meetingPlaceOptions: string[];
  /** この案件を保存中か */
  saving: boolean;
  onSave: (
    recordId: string,
    patch: MeetingScheduleCardPatch,
  ) => Promise<MeetingScheduleCardSaveResult>;
};

/** 選択肢に無い現在値が消えないよう、末尾に足してから出す */
function mergeSelectOptions(options: string[], current: string): string[] {
  const trimmed = current.trim();
  if (!trimmed || options.includes(trimmed)) return options;
  return [...options, trimmed];
}

/**
 * アポ情報一覧の中の商談ステータス編集。
 *
 * 入力・判定・保存は商談予定カードと**同じフック**（use-meeting-schedule-status-form）
 * を使う。ここに条件を書き足さないこと。書き足すと2画面で挙動がずれる。
 *
 * ■ フックに渡す値
 *   statusEditable   … payload の値をそのまま渡す。
 *     ⚠ false を渡してはいけない。resolveMeetingScheduleCardEditability の
 *       canEditStatusDetails は `statusEditable && savable` なので、false にすると
 *       付随項目のフォームも保存ボタンも出なくなる（＝機能が丸ごと消える）。
 *       見積ステータス自体は MEETING_SCHEDULE_LOCKED_FIELDS で塞がっているため、
 *       true を渡しても編集欄は出ない。
 *   scheduleEditable … false。この画面は商談・資料送付予定日時を扱わない。
 *   hasStatusOptions … false。見積ステータスの選択欄を出さないため。
 *
 * ■ 出す条件
 *   見積ステータスが「商談セット作成済み」「返待ち」のときだけ中身がある。
 *   それ以外は保存できる項目が無いので、保存ボタンごと出さない
 *   （商談予定カードは常に保存ボタンを出すが、あちらは日時欄と同居している）。
 */
export function ApoListStatusEditor({
  row,
  statusEditable,
  closeTypeOptions,
  meetingPlaceOptions,
  saving,
  onSave,
}: Props) {
  /** @pocket 側の現在値。差分判定の基準 */
  const server = useMemo(() => apoListRowToCardValues(row), [row]);

  const form = useMeetingScheduleStatusForm({
    recordId: row.recordId,
    server,
    statusEditable,
    scheduleEditable: false,
    hasStatusOptions: false,
    saving,
    onSave,
  });
  const {
    values: draft,
    setters,
    clearFeedback,
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

  const closeOptions = useMemo(
    () => mergeSelectOptions(closeTypeOptions, draft.closeType),
    [closeTypeOptions, draft.closeType],
  );
  const placeOptions = useMemo(
    () => mergeSelectOptions(meetingPlaceOptions, draft.meetingPlace),
    [meetingPlaceOptions, draft.meetingPlace],
  );

  // フックは必ず全部呼んでから抜ける（条件付きで hook を飛ばさない）
  if (!showSetCreatedForm && !showHenmachiForm) return null;

  return (
    /* 左右の余白は中の部品が px-4 で持っているので、-mx-4 で親の px-4 を打ち消す */
    <div className="-mx-4 mb-3 border-b border-slate-100 dark:border-slate-800">
      <div className="px-4">
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
          setNegotiationStatus={setters.setNegotiationStatus}
          setMeetingDate={setters.setMeetingDate}
          setCloseType={setters.setCloseType}
          setMeetingPlace={setters.setMeetingPlace}
          setResponseDate={setters.setResponseDate}
        />
      </div>

      <MeetingScheduleSaveBar
        showSaveBar
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
    </div>
  );
}
