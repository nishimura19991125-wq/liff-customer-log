import {
  isMeetingScheduleNegotiationWaitingStatus,
  isMeetingScheduleReNegotiationStatus,
} from "@/lib/meeting-schedule-shared";

/**
 * 商談ステータス（negotiationStatus）の遷移ルール。
 *
 * 選べる値は現在値によって変わる。キーが @pocket 側の選択肢14件で全て、
 * 値がそこから選べる遷移先。**現在値そのものを先頭に含める**ので、
 * 「変更しない」という選択ができる。
 *
 * 遷移先が空の9件は変更不可。画面では選択欄を出さず値をテキスト表示にする。
 * 変更不可のリストを別に持つと二重管理になるため、「遷移先が空かどうか」
 * だけで表現する。
 *
 * クライアント（選択肢と確認ダイアログ）とサーバ（書き込みの検証）が
 * 同じこの定義を参照する。設定を増やさない方針のため環境変数では
 * 可変にせず、コードに固定する。
 */
export type MeetingScheduleNegotiationStatusSpec = {
  /** この値が現在値のときに選べる値。空なら変更不可 */
  transitions: readonly string[];
  /**
   * 初回商談実施日・片クロor両クロ・商談場所を必須にするか。
   * 必須にしない5件（商談待ち・資料送付回答待ち・資料送付成約・
   * 資料送付否・アポキャン）以外はすべて必須
   */
  requiresMeetingInput: boolean;
  /** 返待ち回答日を必須にするか。「返待ち」のときだけ */
  requiresResponseDate: boolean;
};

/**
 * 遷移先と必須の要否を1つの表で持つ。
 * 必須にする9件・しない5件のリストを別に持つと二重管理になるため、
 * この表のフラグだけで表現する
 */
export const MEETING_SCHEDULE_NEGOTIATION_STATUS_SPECS: Readonly<
  Record<string, MeetingScheduleNegotiationStatusSpec>
> = {
  商談待ち: {
    transitions: ["商談待ち", "即決成約", "再商談", "返待ち", "否", "アポキャン"],
    requiresMeetingInput: false,
    requiresResponseDate: false,
  },
  再商談: {
    transitions: ["再商談", "再商談成約", "再商談否", "再商談日調整中", "返待ち"],
    requiresMeetingInput: true,
    requiresResponseDate: false,
  },
  返待ち: {
    transitions: ["返待ち", "返待ち成約", "返待ち否", "再商談"],
    requiresMeetingInput: true,
    requiresResponseDate: true,
  },
  資料送付回答待ち: {
    transitions: ["資料送付回答待ち", "資料送付成約", "資料送付否", "再商談"],
    requiresMeetingInput: false,
    requiresResponseDate: false,
  },
  再商談日調整中: {
    transitions: ["再商談日調整中", "再商談", "再商談成約", "再商談否", "返待ち"],
    requiresMeetingInput: true,
    requiresResponseDate: false,
  },

  // ここから下は変更不可（遷移先が空）
  即決成約: { transitions: [], requiresMeetingInput: true, requiresResponseDate: false },
  再商談成約: { transitions: [], requiresMeetingInput: true, requiresResponseDate: false },
  返待ち成約: { transitions: [], requiresMeetingInput: true, requiresResponseDate: false },
  否: { transitions: [], requiresMeetingInput: true, requiresResponseDate: false },
  再商談否: { transitions: [], requiresMeetingInput: true, requiresResponseDate: false },
  返待ち否: { transitions: [], requiresMeetingInput: true, requiresResponseDate: false },
  アポキャン: { transitions: [], requiresMeetingInput: false, requiresResponseDate: false },
  資料送付成約: { transitions: [], requiresMeetingInput: false, requiresResponseDate: false },
  資料送付否: { transitions: [], requiresMeetingInput: false, requiresResponseDate: false },
};

/** @pocket 側の商談ステータス選択肢。表のキーがそのまま全件 */
export const MEETING_SCHEDULE_NEGOTIATION_STATUSES: readonly string[] =
  Object.keys(MEETING_SCHEDULE_NEGOTIATION_STATUS_SPECS);

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

/**
 * 遷移表に載っている値なら正規化して返す。載っていなければ null。
 *
 * @pocket の値には全角・前後の空白のゆれがあり得るので、
 * 突き合わせは正規化してから行う。
 */
export function normalizeMeetingScheduleNegotiationStatus(
  raw: string,
): string | null {
  const status = nfkc(raw);
  if (!status) return null;
  return (
    MEETING_SCHEDULE_NEGOTIATION_STATUSES.find((s) => nfkc(s) === status) ?? null
  );
}

/**
 * 現在値から選べる商談ステータス。現在値が先頭に入る。
 *
 * 遷移表に無い値（@pocket 側で選択肢が増えた・空欄など）は空配列を返す。
 * 呼び出し側は「選択欄を出さずテキスト表示にする」で扱う
 */
export function meetingScheduleNegotiationOptionsFor(
  currentRaw: string,
): string[] {
  const current = normalizeMeetingScheduleNegotiationStatus(currentRaw);
  if (!current) return [];
  return [...MEETING_SCHEDULE_NEGOTIATION_STATUS_SPECS[current].transitions];
}

/** 現在値から商談ステータスを変更できるか。遷移先が空なら変更不可 */
export function canEditMeetingScheduleNegotiationStatus(
  currentRaw: string,
): boolean {
  return meetingScheduleNegotiationOptionsFor(currentRaw).length > 0;
}

/** 現在値から変更後の値へ遷移できるか。サーバ側の検証にも使う */
export function canTransitionMeetingScheduleNegotiationStatus(
  currentRaw: string,
  nextRaw: string,
): boolean {
  const next = normalizeMeetingScheduleNegotiationStatus(nextRaw);
  if (!next) return false;
  return meetingScheduleNegotiationOptionsFor(currentRaw).includes(next);
}

/**
 * 出勤後アラートに残る商談ステータスか。
 *
 * filterPendingMeetingAlerts が使っているのと**同じ判定関数**を組み合わせる。
 * 値のリストをこちらに書き写すと二重管理になり、
 * 片方だけ直したときに確認ダイアログの有無とアラートの実態がずれる。
 */
export function keepsMeetingScheduleAlert(negotiationStatusRaw: string): boolean {
  const status = negotiationStatusRaw.trim();
  return (
    isMeetingScheduleNegotiationWaitingStatus(status) ||
    isMeetingScheduleReNegotiationStatus(status)
  );
}

/**
 * 保存前に確認ダイアログを出すか。
 *
 * 実際に値が変わるときだけ、かつ変更後の値でアラートから消えるときに出す。
 * 現在値のまま保存する場合は何も変わらないので出さない。
 */
export function needsMeetingScheduleNegotiationConfirm(
  currentRaw: string,
  nextRaw: string,
): boolean {
  const next = nfkc(nextRaw);
  if (!next) return false;
  if (next === nfkc(currentRaw)) return false;
  return !keepsMeetingScheduleAlert(next);
}

/**
 * 確認ダイアログの本文。
 *
 * 「元に戻せません」とは書かない。実際は戻せる遷移もある。
 */
export function meetingScheduleNegotiationConfirmMessage(
  nextNegotiationStatus: string,
): string {
  return `商談ステータスを「${nextNegotiationStatus.trim()}」に変更します。\nこの案件は出勤後の入力アラートに表示されなくなります。`;
}

/* ------------------------------------------------------------------ *
 * 「商談セット作成済みの入力項目」（初回商談実施日・片クロor両クロ・
 * 商談場所・返待ち回答日）の編集ルール。
 *
 * 必須の要否が商談ステータスで決まるため、遷移表と同じこのファイルに置く。
 * 必須の9件/5件をリストとして別に持たず、上の表のフラグから導く。
 * ------------------------------------------------------------------ */

export type MeetingScheduleInputFieldKey =
  | "meetingDate"
  | "closeType"
  | "meetingPlace"
  | "responseDate";

export const MEETING_SCHEDULE_INPUT_FIELD_LABELS: Record<
  MeetingScheduleInputFieldKey,
  string
> = {
  meetingDate: "初回商談実施日",
  closeType: "片クロor両クロ",
  meetingPlace: "商談場所",
  responseDate: "返待ち回答日",
};

/**
 * どの入力枠がどの項目を描画するか。
 * 同じ項目が両方に現れないこと（二重描画の防止）をテストで固定する
 */
export const MEETING_SCHEDULE_INPUT_FIELDS_BY_FORM: Record<
  "setCreated" | "henmachi",
  readonly MeetingScheduleInputFieldKey[]
> = {
  setCreated: ["meetingDate", "closeType", "meetingPlace"],
  henmachi: ["responseDate"],
};

/** 4項目の値の組。@pocket 側の現在値と画面の入力値を同じ形で持つ */
export type MeetingScheduleInputValues = Record<
  MeetingScheduleInputFieldKey,
  string
>;

/** 初回商談実施日・片クロor両クロ・商談場所を必須にする商談ステータスか */
export function requiresMeetingScheduleMeetingInput(
  negotiationStatusRaw: string,
): boolean {
  const status = normalizeMeetingScheduleNegotiationStatus(negotiationStatusRaw);
  if (!status) return false;
  return MEETING_SCHEDULE_NEGOTIATION_STATUS_SPECS[status].requiresMeetingInput;
}

/** 返待ち回答日を必須にする商談ステータスか */
export function requiresMeetingScheduleResponseDate(
  negotiationStatusRaw: string,
): boolean {
  const status = normalizeMeetingScheduleNegotiationStatus(negotiationStatusRaw);
  if (!status) return false;
  return MEETING_SCHEDULE_NEGOTIATION_STATUS_SPECS[status].requiresResponseDate;
}

/**
 * その項目が入力済みで変更できないか。
 *
 * 判定は項目ごとに個別。1つ入力しても他の項目は入力できる。
 * 正は @pocket 側の現在値で、サーバもクライアントもこの関数を通す。
 */
export function isMeetingScheduleInputLocked(currentValue: string): boolean {
  return currentValue.trim() !== "";
}

/** 空だった項目に値を入れようとしているか */
export function isMeetingScheduleInputNewlyEntered(
  currentValue: string,
  draftValue: string,
): boolean {
  return !currentValue.trim() && draftValue.trim() !== "";
}

/**
 * 返待ち回答日の入力枠を出すか。
 *
 * 見積ステータスが「返待ち」のときに加えて、商談ステータスが「返待ち」の
 * ときも出す。必須の基準を商談ステータスへ移したため、こちらも広げないと
 * 「必須なのに入力欄が無い」状態になり、保存が永久にできなくなる。
 * 「必須ならば必ず入力できる」を構造で保証するための条件。
 */
export function showsMeetingScheduleHenmachiForm(input: {
  /** 見積ステータスが返待ちか（isMeetingScheduleHenmachiStatus の結果） */
  estimateStatusIsHenmachi: boolean;
  /** 変更後の商談ステータス */
  negotiationStatus: string;
}): boolean {
  return (
    input.estimateStatusIsHenmachi ||
    requiresMeetingScheduleResponseDate(input.negotiationStatus)
  );
}

/** 必須が満たされていないときの文言。画面用と API 用で言い回しが違う */
export const MEETING_SCHEDULE_INPUT_BLOCKED_HINTS: Record<
  MeetingScheduleInputFieldKey,
  string
> = {
  meetingDate: "初回商談実施日を入力すると保存できます",
  closeType: "片クロor両クロを選ぶと保存できます",
  meetingPlace: "商談場所を選ぶと保存できます",
  responseDate: "返待ち回答日を入力すると保存できます",
};

export const MEETING_SCHEDULE_INPUT_REQUIRED_ERRORS: Record<
  MeetingScheduleInputFieldKey,
  string
> = {
  meetingDate: "初回商談実施日を入力してください",
  closeType: "片クロor両クロを選択してください",
  meetingPlace: "商談場所を選択してください",
  responseDate: "返待ち回答日を入力してください",
};

/**
 * 必須なのに埋まっていない項目を返す。埋まっていれば null。
 *
 * 全件に必須を課すと、対象項目が空のまま残っている既存案件が
 * 編集不能になる。そこで検証するのは
 *   ・3項目のいずれかを新規入力するとき
 *   ・商談ステータスを変更するとき
 * だけに限り、これらに触らない保存は止めない。
 * 埋まっているかどうかは「@pocket の既存値 または 今回の新規入力」で見る。
 *
 * 文言はクライアント・サーバでそれぞれ付ける（言い回しが違うため）。
 */
export function findMissingMeetingScheduleRequiredInput(input: {
  server: MeetingScheduleInputValues;
  draft: MeetingScheduleInputValues;
  serverNegotiationStatus: string;
  draftNegotiationStatus: string;
}): MeetingScheduleInputFieldKey | null {
  const { server, draft } = input;
  const negotiationChanged =
    input.draftNegotiationStatus.trim() !== input.serverNegotiationStatus.trim();

  /** 既存値があるか、今回入力されるか */
  const filled = (key: MeetingScheduleInputFieldKey): boolean =>
    Boolean(server[key].trim() || draft[key].trim());
  const newlyEntered = (key: MeetingScheduleInputFieldKey): boolean =>
    isMeetingScheduleInputNewlyEntered(server[key], draft[key]);

  const next = input.draftNegotiationStatus;

  if (requiresMeetingScheduleMeetingInput(next)) {
    const touched =
      newlyEntered("meetingDate") ||
      newlyEntered("closeType") ||
      newlyEntered("meetingPlace") ||
      negotiationChanged;

    if (touched) {
      if (!filled("meetingDate")) return "meetingDate";
      if (!filled("closeType")) return "closeType";
      if (!filled("meetingPlace")) return "meetingPlace";
    }
  }

  if (requiresMeetingScheduleResponseDate(next)) {
    if (newlyEntered("responseDate") || negotiationChanged) {
      if (!filled("responseDate")) return "responseDate";
    }
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * 保存前の確認ダイアログ。
 *
 * 商談ステータスの変更と、入力の確定は同時に起こり得る。
 * ダイアログを2つ続けて出さないよう、本文をブロックで組み立てて
 * 1つにまとめる。該当するブロックだけを並べる。
 * ------------------------------------------------------------------ */

export type MeetingScheduleSaveConfirm = {
  /** 確認が必要か。false なら本文は空 */
  needed: boolean;
  title: string;
  /** 段落。改行2つで連結して表示する */
  blocks: string[];
};

/** 確認ダイアログに並べる「今回新たに入力される項目」 */
export type MeetingScheduleConfirmEntry = {
  label: string;
  /** 表示用に整形済みの値 */
  value: string;
};

export function buildMeetingScheduleSaveConfirm(input: {
  serverNegotiationStatus: string;
  draftNegotiationStatus: string;
  /** 空だった項目に今回入力される値。呼び出し側で表示用に整形しておく */
  newlyEntered: readonly MeetingScheduleConfirmEntry[];
}): MeetingScheduleSaveConfirm {
  const blocks: string[] = [];

  const negotiationConfirm = needsMeetingScheduleNegotiationConfirm(
    input.serverNegotiationStatus,
    input.draftNegotiationStatus,
  );
  if (negotiationConfirm) {
    blocks.push(
      meetingScheduleNegotiationConfirmMessage(input.draftNegotiationStatus),
    );
  }

  const entries = input.newlyEntered.filter((e) => e.value.trim() !== "");
  if (entries.length > 0) {
    blocks.push(
      [
        "以下の項目を保存します。保存後は変更できません。",
        ...entries.map((e) => `・${e.label}: ${e.value}`),
      ].join("\n"),
    );
  }

  const title =
    negotiationConfirm && entries.length > 0
      ? "商談ステータスの変更と入力の確定"
      : negotiationConfirm
        ? "商談ステータスの変更"
        : "入力内容の確定";

  return { needed: blocks.length > 0, title, blocks };
}
