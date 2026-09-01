"use client";

import { MeetingScheduleNegotiationConfirmDialog } from "@/components/meeting-schedule-negotiation-confirm-dialog";
import type {
  MeetingScheduleLockedInputs,
  MeetingScheduleStatusFormFeedback,
} from "@/hooks/use-meeting-schedule-status-form";
import { formatDisplayYmd } from "@/lib/format-display-ymd";
import type { MeetingScheduleCardValues } from "@/lib/meeting-schedule-card-save";
import type { MeetingScheduleSaveConfirm } from "@/lib/meeting-schedule-negotiation-status";
import { MEETING_SCHEDULE_INPUT_FIELD_LABELS } from "@/lib/meeting-schedule-negotiation-status";

/**
 * 商談ステータスと付随項目の入力欄、および保存バー。
 *
 * 商談予定（/meeting-schedule）とアポ情報一覧（/apo-list・段階C）で
 * **同じ見た目**にするために切り出した。判定は
 * useMeetingScheduleStatusForm が持ち、ここは受け取った値を描くだけ。
 *
 * ⚠ ここに条件を書かないこと。出し分けはすべてフックから受け取る
 *    （画面ごとに条件を書き足すと、そこからずれが始まる）。
 */

/** 入力欄。min-w-0 / max-w-full は親（緑枠など）からのはみ出し防止 */
export const inputClass =
  "w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] text-slate-900 shadow-sm disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

/**
 * `type="date"` / `type="time"` は UA 既定の最小幅で width:100% を無視し
 * 親からはみ出す。globals.css の .datetime-input-fit で抑える。
 */
export const dateTimeInputClass = `${inputClass} datetime-input-fit`;

/**
 * 保存ボタンの無効時の見た目。
 *
 * 以前は色付きの背景に opacity-50 を重ねるだけで、薄い緑のまま押せそうに見え、
 * 押しても反応しないため「壊れている」と受け取られていた。
 * 背景ごと灰色に落とし、カーソルでも押せないことを示す。
 */
export const saveButtonClass =
  "w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-[14px] font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:opacity-100 disabled:shadow-none dark:bg-emerald-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400";

/** 無効な理由。押せる条件が分かるよう、ボタンの下に小さく出す */
export const saveHintClass =
  "mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400";

/**
 * 編集不可な項目の値。入力欄と同じ高さ・余白にして行の並びを崩さないが、
 * 枠線と白背景は外し、触れないことが見た目で分かるようにする
 */
export const readOnlyValueClass =
  "w-full min-w-0 max-w-full rounded-xl bg-slate-100 px-3 py-2.5 text-[14px] text-slate-900 dark:bg-slate-800 dark:text-white";

/** なぜ触れないのかの補足。値の下に小さく出す */
export const readOnlyNoteClass =
  "mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400";

/**
 * 入力済みで変更できなくなった項目。ラベルは残し、値だけをテキストで見せる。
 * 見積ステータス・商談ステータスの編集不可表示と同じ形にそろえる
 */
export function LockedInputRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
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

export type MeetingScheduleNegotiationFieldsProps = {
  /** 入力中の値 */
  values: MeetingScheduleCardValues;
  /** @pocket 側の現在値。入力済みロックの表示に使う */
  server: MeetingScheduleCardValues;
  saving: boolean;
  showSetCreatedForm: boolean;
  showHenmachiForm: boolean;
  canEditNegotiation: boolean;
  negotiationOptions: string[];
  closeOptions: string[];
  placeOptions: string[];
  lockedInputs: MeetingScheduleLockedInputs;
  clearFeedback: () => void;
  setNegotiationStatus: (v: string) => void;
  setMeetingDate: (v: string) => void;
  setCloseType: (v: string) => void;
  setMeetingPlace: (v: string) => void;
  setResponseDate: (v: string) => void;
};

export type MeetingScheduleSaveBarProps = {
  showSaveBar: boolean;
  canSave: boolean;
  saving: boolean;
  saveHint: string;
  dirty: boolean;
  feedback: MeetingScheduleStatusFormFeedback | null;
  saveConfirm: MeetingScheduleSaveConfirm;
  confirmingNegotiation: boolean;
  requestSave: () => void;
  runSave: () => void | Promise<void>;
  cancelConfirm: () => void;
};

/**
 * 商談セット作成済みの入力項目（商談ステータス・初回商談実施日・
 * 片クロor両クロ・商談場所・返待ち回答日）。
 *
 * 出す／出さないの判定は持たない。showSetCreatedForm と showHenmachiForm を
 * そのまま使う（フックが決める）。
 */
export function MeetingScheduleNegotiationFields({
  values,
  server,
  saving,
  showSetCreatedForm,
  showHenmachiForm,
  canEditNegotiation,
  negotiationOptions,
  closeOptions,
  placeOptions,
  lockedInputs,
  clearFeedback,
  setNegotiationStatus,
  setMeetingDate,
  setCloseType,
  setMeetingPlace,
  setResponseDate,
}: MeetingScheduleNegotiationFieldsProps) {
  const { negotiationStatus, meetingDate, closeType, meetingPlace, responseDate } =
    values;

  return (
    <>
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
                {server.negotiationStatus || "未設定"}
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

    </>
  );
}

/**
 * 保存ボタン・押せない理由・未保存の案内・保存結果・確認ダイアログ。
 *
 * 「保存できるか」「何を出すか」は持たない。フックが決めた値を描くだけ。
 */
export function MeetingScheduleSaveBar({
  showSaveBar,
  canSave,
  saving,
  saveHint,
  dirty,
  feedback,
  saveConfirm,
  confirmingNegotiation,
  requestSave,
  runSave,
  cancelConfirm,
}: MeetingScheduleSaveBarProps) {
  return (
    <>
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
          dirty
            ? "text-amber-800 dark:text-amber-300"
            : "text-emerald-800 dark:text-emerald-300"
        }`}
      >
        {dirty
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


      <MeetingScheduleNegotiationConfirmDialog
        open={confirmingNegotiation}
        title={saveConfirm.title}
        message={saveConfirm.blocks.join("\n\n")}
        onConfirm={() => void runSave()}
        onCancel={cancelConfirm}
      />
    </>
  );
}
