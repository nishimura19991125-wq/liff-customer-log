"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { formatDisplayYmd } from "@/lib/format-display-ymd";
import {
  planMeetingScheduleCardSave,
  type MeetingScheduleCardPatch,
  type MeetingScheduleCardValues,
} from "@/lib/meeting-schedule-card-save";
import { resolveMeetingScheduleCardEditability } from "@/lib/meeting-schedule-locked-fields";
import {
  buildMeetingScheduleSaveConfirm,
  isMeetingScheduleInputLocked,
  isMeetingScheduleInputNewlyEntered,
  meetingScheduleNegotiationOptionsFor,
  showsMeetingScheduleHenmachiForm,
  MEETING_SCHEDULE_INPUT_FIELD_LABELS,
} from "@/lib/meeting-schedule-negotiation-status";
import {
  isMeetingScheduleHenmachiStatus,
  isMeetingScheduleSetCreatedStatus,
} from "@/lib/meeting-schedule-shared";

/**
 * 商談ステータスと付随項目の編集をまとめて面倒みるフック。
 *
 * ── なぜ切り出したか ───────────────────────────────────────
 * 同じ編集をアポ情報一覧（/apo-list）にも載せる。画面ごとに書き分けると
 * 次の4つがずれる余地が残る（調査で実際に挙がったもの）。
 *
 *   1. フォームの表示条件（見積ステータス＝商談セット作成済み）
 *   2. 返待ち回答日の枠を出す条件（見積ステータス or 商談ステータス）
 *   3. 保存後にどの項目を差し替えるか
 *   4. 保存ボタンの有効条件
 *
 * 1・2・4 はここが返す値を使う限りずれない。3 は画面ごとに作りが違う
 * （商談予定は変わった項目だけ差し替え、アポ情報一覧は全件取り直し）ので、
 * onSave の戻り値をそのまま親へ返し、**親が決める**。
 *
 * ── 見積ステータス・日時も預かる理由 ─────────────────────
 * 保存は1つのボタンで、@pocket へは見積ステータス・日時・付随項目を
 * まとめて送る（planMeetingScheduleCardSave）。付随項目だけを切り出すと
 * 商談予定の保存ボタンが2つに割れるので、値は8つとも預かる。
 *
 * アポ情報一覧では statusEditable / scheduleEditable を false にする。
 * そのとき plan は付随項目だけを送る patch を組み立てる。
 *
 * 判定そのものはここに書かない。すべて src/lib の純粋関数へ委ねる。
 */

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

export type MeetingScheduleStatusFormFeedback =
  | { kind: "ok"; message: string }
  | { kind: "error"; messages: string[] };

/** 入力済みで変更できない項目。@pocket 側の現在値で項目ごとに判定する */
export type MeetingScheduleLockedInputs = {
  meetingDate: boolean;
  closeType: boolean;
  meetingPlace: boolean;
  responseDate: boolean;
};

export type UseMeetingScheduleStatusFormInput = {
  /** どのレコードの編集か。差し替わったら入力を作り直す */
  recordId: string;
  /** @pocket 側の現在値。差分判定の基準 */
  server: MeetingScheduleCardValues;
  /** 見積ステータスそのものを変更できるか */
  statusEditable: boolean;
  /** 商談・資料送付予定日時を変更できるか */
  scheduleEditable: boolean;
  /** 見積ステータスの選択肢があるか。無ければ選択欄を出さない */
  hasStatusOptions: boolean;
  /** この案件を保存中か */
  saving: boolean;
  onSave?: (
    recordId: string,
    patch: MeetingScheduleCardPatch,
  ) => Promise<MeetingScheduleCardSaveResult>;
};

export function useMeetingScheduleStatusForm(
  input: UseMeetingScheduleStatusFormInput,
) {
  const { recordId, server, saving, onSave } = input;

  const [draftStatus, setDraftStatus] = useState(server.estimateStatus);
  const [scheduledYmd, setScheduledYmd] = useState(server.scheduledYmd);
  const [scheduledTime, setScheduledTime] = useState(server.scheduledTime);
  const [meetingDate, setMeetingDate] = useState(server.meetingDate);
  const [closeType, setCloseType] = useState(server.closeType);
  const [meetingPlace, setMeetingPlace] = useState(server.meetingPlace);
  const [responseDate, setResponseDate] = useState(server.responseDate);
  const [negotiationStatus, setNegotiationStatus] = useState(
    server.negotiationStatus,
  );
  /** 確認ダイアログを出しているか */
  const [confirmingNegotiation, setConfirmingNegotiation] = useState(false);
  const [feedback, setFeedback] =
    useState<MeetingScheduleStatusFormFeedback | null>(null);

  const recordIdRef = useRef(recordId);
  const prevServerRef = useRef(server);

  useEffect(() => {
    const prev = prevServerRef.current;
    prevServerRef.current = server;

    // 別のレコードに差し替わったときだけ全部入れ替える
    if (recordIdRef.current !== recordId) {
      recordIdRef.current = recordId;
      setDraftStatus(server.estimateStatus);
      setScheduledYmd(server.scheduledYmd);
      setScheduledTime(server.scheduledTime);
      setMeetingDate(server.meetingDate);
      setCloseType(server.closeType);
      setMeetingPlace(server.meetingPlace);
      setResponseDate(server.responseDate);
      setNegotiationStatus(server.negotiationStatus);
      setConfirmingNegotiation(false);
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
    if (prev.negotiationStatus !== server.negotiationStatus) {
      setNegotiationStatus(server.negotiationStatus);
    }
  }, [server, recordId]);

  /**
   * 選べる値は現在値で決まる（遷移ルール）。現在値が先頭に入る。
   *
   * 空になるのは変更不可の9件と、遷移表に無い値・空欄のとき。
   * その場合は選択欄を出さず値をテキストで見せる
   */
  const negotiationOptions = useMemo(
    () => meetingScheduleNegotiationOptionsFor(server.negotiationStatus),
    [server.negotiationStatus],
  );
  const canEditNegotiation = negotiationOptions.length > 0;

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
    statusEditable: input.statusEditable,
    scheduleEditable: input.scheduleEditable,
    savable: Boolean(onSave),
    hasStatusOptions: input.hasStatusOptions,
  });

  const showSetCreatedForm =
    canEditStatusDetails && isMeetingScheduleSetCreatedStatus(draftStatus);
  /**
   * 返待ち回答日の枠は、見積ステータスが返待ちのときに加えて
   * 商談ステータスが返待ちのときも出す。必須の基準を商談ステータスへ
   * 移したため、広げないと「必須なのに入力欄が無い」状態になる
   */
  const showHenmachiForm =
    canEditStatusDetails &&
    showsMeetingScheduleHenmachiForm({
      estimateStatusIsHenmachi: isMeetingScheduleHenmachiStatus(draftStatus),
      negotiationStatus,
    });

  const lockedInputs: MeetingScheduleLockedInputs = {
    meetingDate: isMeetingScheduleInputLocked(server.meetingDate),
    closeType: isMeetingScheduleInputLocked(server.closeType),
    meetingPlace: isMeetingScheduleInputLocked(server.meetingPlace),
    responseDate: isMeetingScheduleInputLocked(server.responseDate),
  };

  const draft: MeetingScheduleCardValues = {
    estimateStatus: draftStatus,
    scheduledYmd,
    scheduledTime,
    meetingDate,
    closeType,
    meetingPlace,
    responseDate,
    negotiationStatus,
  };
  const plan = planMeetingScheduleCardSave(server, draft, {
    statusEditable: canEditStatus,
    statusDetailsEditable: canEditStatusDetails,
    scheduleEditable: canEditSchedule,
  });

  const canSave = plan.dirty && !plan.blockedReason && !saving;

  /**
   * 触れる項目が1つでもあるか。
   * すべて入力済みで商談ステータスも変更不可だと、この枠は表示専用になる。
   * 保存ボタンは（消さずに）無効のまま残し、文言だけ実態に合わせる
   */
  const hasEditableField =
    canEditStatus ||
    canEditSchedule ||
    (showSetCreatedForm &&
      (canEditNegotiation ||
        !lockedInputs.meetingDate ||
        !lockedInputs.closeType ||
        !lockedInputs.meetingPlace)) ||
    (showHenmachiForm && !lockedInputs.responseDate);

  /** 押せない理由。保存中は出さない（ボタンの文言で分かる） */
  const saveHint = saving
    ? ""
    : plan.dirty
      ? plan.blockedReason
      : !hasEditableField
        ? "変更できる項目はありません"
        : canEditStatus || canEditSchedule
          ? "ステータスか日時を変更すると保存できます"
          : "入力項目を変更すると保存できます";

  /** 入力のたびに前回の保存結果を消す。古い成否が残ると読み違える */
  const clearFeedback = () => setFeedback(null);

  /** 今回はじめて値が入る項目。確認ダイアログに並べる */
  const newlyEnteredEntries = (
    [
      ["meetingDate", server.meetingDate, meetingDate, true],
      ["closeType", server.closeType, closeType, false],
      ["meetingPlace", server.meetingPlace, meetingPlace, false],
      ["responseDate", server.responseDate, responseDate, true],
    ] as const
  )
    .filter(([, current, next]) =>
      isMeetingScheduleInputNewlyEntered(current, next),
    )
    .map(([key, , next, isDate]) => ({
      label: MEETING_SCHEDULE_INPUT_FIELD_LABELS[key],
      value: isDate ? formatDisplayYmd(next) : next,
    }));

  /**
   * 保存前の確認。商談ステータスの変更と入力の確定は同時に起こり得るので、
   * ダイアログを2つ続けて出さずに1つへまとめる。
   * 本文の組み立ては src/lib 側の純粋関数が持つ
   */
  const saveConfirm = buildMeetingScheduleSaveConfirm({
    serverNegotiationStatus: server.negotiationStatus,
    draftNegotiationStatus: negotiationStatus,
    newlyEntered: newlyEnteredEntries,
  });

  const runSave = async () => {
    if (!onSave || !canSave) return;
    setConfirmingNegotiation(false);
    setFeedback(null);
    const result = await onSave(recordId, plan.patch);
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

  /** 保存ボタンの押下。確認が要る変更は承諾されるまで保存しない */
  const requestSave = () => {
    if (saveConfirm.needed) {
      setConfirmingNegotiation(true);
      return;
    }
    void runSave();
  };

  return {
    values: draft,
    setters: {
      setDraftStatus,
      setScheduledYmd,
      setScheduledTime,
      setMeetingDate,
      setCloseType,
      setMeetingPlace,
      setResponseDate,
      setNegotiationStatus,
    },
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
    cancelConfirm: () => setConfirmingNegotiation(false),
  };
}
