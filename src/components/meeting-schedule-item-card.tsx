"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { LiffCard } from "@/components/liff-chrome";
import { MapNavigationButton } from "@/components/map-navigation-button";
import { formatCustomerNameForDisplay } from "@/lib/customer-name-display";
import {
  isMeetingScheduleHenmachiStatus,
  isMeetingScheduleSetCreatedStatus,
} from "@/lib/meeting-schedule-shared";
import {
  planMeetingScheduleCardSave,
  type MeetingScheduleCardPatch,
  type MeetingScheduleCardValues,
} from "@/lib/meeting-schedule-card-save";
import { resolveMeetingScheduleCardEditability } from "@/lib/meeting-schedule-locked-fields";
import type { MeetingScheduleItem } from "@/lib/meeting-schedule-types";
import { buildMapNavigation } from "@/lib/map-navigation";

/** 保存の結果。片方だけ失敗したときは errors にその分だけ入る */
export type MeetingScheduleCardSaveResult = {
  /** 日時を保存したか。送っていないときは undefined */
  scheduleOk?: boolean;
  /** 見積ステータスを保存したか。送っていないときは undefined */
  statusOk?: boolean;
  errors: string[];
  /**
   * 日時の更新に伴い見積ステータスが自動で変わったときの値。
   *
   * 【現在は到達不能】商談・資料送付予定日時が LIFF から編集不可になったため、
   * これを立てる唯一の経路（PATCH .../schedule）が塞がっている。
   * 日時編集を復活させる場合は、meeting-schedule-locked-fields.ts の
   * MEETING_SCHEDULE_LOCKED_FIELDS から "scheduledDateTime" を外すのと同時に、
   * この通知経路（page.tsx の handleSave と meeting-schedule.ts の
   * scheduleDateChanged 周辺の自動リセット）も同時に有効化すること。
   */
  autoEstimateStatus?: string;
};

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
    }),
    [
      item.estimateStatus,
      item.scheduledYmd,
      item.scheduledTime,
      item.firstMeetingDateYmd,
      item.closeType,
      item.meetingPlace,
      item.responseDateYmd,
    ],
  );

  const [draftStatus, setDraftStatus] = useState(server.estimateStatus);
  const [scheduledYmd, setScheduledYmd] = useState(server.scheduledYmd);
  const [scheduledTime, setScheduledTime] = useState(server.scheduledTime);
  const [meetingDate, setMeetingDate] = useState(server.meetingDate);
  const [closeType, setCloseType] = useState(server.closeType);
  const [meetingPlace, setMeetingPlace] = useState(server.meetingPlace);
  const [responseDate, setResponseDate] = useState(server.responseDate);
  const [feedback, setFeedback] = useState<
    { kind: "ok"; message: string } | { kind: "error"; messages: string[] } | null
  >(null);

  const recordIdRef = useRef(item.recordId);
  const prevServerRef = useRef(server);

  useEffect(() => {
    const prev = prevServerRef.current;
    prevServerRef.current = server;

    // 別のレコードに差し替わったときだけ全部入れ替える
    if (recordIdRef.current !== item.recordId) {
      recordIdRef.current = item.recordId;
      setDraftStatus(server.estimateStatus);
      setScheduledYmd(server.scheduledYmd);
      setScheduledTime(server.scheduledTime);
      setMeetingDate(server.meetingDate);
      setCloseType(server.closeType);
      setMeetingPlace(server.meetingPlace);
      setResponseDate(server.responseDate);
      setFeedback(null);
      return;
    }

    // 保存後の再取得。@pocket 側が実際に変わった項目だけ入れ替える。
    // 一括で入れ替えると、片方だけ保存に失敗したときに未保存の入力まで
    // 消えてしまい、失敗した分を押し直すことができない
    if (prev.estimateStatus !== server.estimateStatus) {
      setDraftStatus(server.estimateStatus);
    }
    if (prev.scheduledYmd !== server.scheduledYmd) {
      setScheduledYmd(server.scheduledYmd);
    }
    if (prev.scheduledTime !== server.scheduledTime) {
      setScheduledTime(server.scheduledTime);
    }
    if (prev.meetingDate !== server.meetingDate) setMeetingDate(server.meetingDate);
    if (prev.closeType !== server.closeType) setCloseType(server.closeType);
    if (prev.meetingPlace !== server.meetingPlace) {
      setMeetingPlace(server.meetingPlace);
    }
    if (prev.responseDate !== server.responseDate) {
      setResponseDate(server.responseDate);
    }
  }, [server, item.recordId]);

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

  /**
   * どの UI を出すかは src/lib 側の純粋関数に寄せてある。
   * 見積ステータス・日時が編集不可でも、付随項目の入力欄と保存ボタンは残る
   */
  const {
    canEditStatus,
    canEditSchedule,
    canEditStatusDetails,
    showStatusText,
    showScheduleText,
    showSaveBar,
  } = resolveMeetingScheduleCardEditability({
    statusEditable,
    scheduleEditable,
    savable: Boolean(onSave),
    hasStatusOptions: selectOptions.length > 0,
  });

  const showSetCreatedForm =
    canEditStatusDetails && isMeetingScheduleSetCreatedStatus(draftStatus);
  const showHenmachiForm =
    canEditStatusDetails && isMeetingScheduleHenmachiStatus(draftStatus);

  const draft: MeetingScheduleCardValues = {
    estimateStatus: draftStatus,
    scheduledYmd,
    scheduledTime,
    meetingDate,
    closeType,
    meetingPlace,
    responseDate,
  };
  const plan = planMeetingScheduleCardSave(server, draft, {
    statusEditable: canEditStatus,
    statusDetailsEditable: canEditStatusDetails,
    scheduleEditable: canEditSchedule,
  });

  const canSave = plan.dirty && !plan.blockedReason && !saving;

  /** 押せない理由。保存中は出さない（ボタンの文言で分かる） */
  const saveHint = saving
    ? ""
    : plan.dirty
      ? plan.blockedReason
      : canEditStatus || canEditSchedule
        ? "ステータスか日時を変更すると保存できます"
        : "入力項目を変更すると保存できます";

  /** 入力のたびに前回の保存結果を消す。古い成否が残ると読み違える */
  const clearFeedback = () => setFeedback(null);

  const handleSave = async () => {
    if (!onSave || !canSave) return;
    setFeedback(null);
    const result = await onSave(item.recordId, plan.patch);
    if (result.errors.length > 0) {
      setFeedback({ kind: "error", messages: result.errors });
      return;
    }
    setFeedback({
      kind: "ok",
      message: result.autoEstimateStatus
        ? `保存しました（見積ステータスを${result.autoEstimateStatus}に変更しました）`
        : "保存しました",
    });
  };

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
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                  初回商談実施日
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
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                  片クロor両クロ
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
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                  商談場所
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
            </div>
          ) : null}

          {showHenmachiForm ? (
            <div className="mt-3 space-y-3 rounded-xl border border-violet-100 bg-violet-50/60 p-3 dark:border-violet-900/50 dark:bg-violet-950/20">
              <p className="text-[12px] font-semibold text-violet-800 dark:text-violet-200">
                返待ちの入力項目
              </p>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                  返待ち回答日
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
            onClick={() => void handleSave()}
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
    </LiffCard>
  );
}
