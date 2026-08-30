import type { MoveTargetSlot } from "@/lib/calendar-move-target-slots";
import { formatDisplayYmd } from "@/lib/format-display-ymd";

/**
 * 工事日変更（M-3）の移動先選択。空き枠か新規作成かを**ラジオで選ばせる**。
 *
 * ■ 「未選択」を「新規作成」と別の値にする
 * 以前は selectedSlotId の空文字が「新規作成」を兼ねていた。日付を選んだ
 * 時点で新規作成が選ばれている状態になり、
 *   ・利用者が枠の有無を見ないまま実行できる
 *   ・新規作成のときだけ出したい施工業者の欄が常に出る
 * の2つが避けられない。工事日の移動は元に戻せないので、枠を使うのか
 * 作るのかは**1回選ばせる**。
 *
 * ■ 施工業者を必須にするのは、一覧を引けているときだけ
 * 取引先会社一覧の環境変数が未設定だと選択肢が1つも出ない。そこで必須に
 * すると新規作成での移動が一切できなくなる（今はできる）。引けないときは
 * 従来どおり API 側の引き継ぎ（枠 → 画面の指定 → 移動元）に任せる。
 */

/** まだ選んでいない。実行させない */
export const MOVE_SLOT_CHOICE_NONE = "";
/** 空き枠を使わず新しいレコードを作る */
export const MOVE_SLOT_CHOICE_NEW = "__new__";

/** ラジオの選択肢1つぶん */
export type MoveSlotChoice = {
  /** ラジオの value。空き枠なら recordId、新規作成なら __new__ */
  value: string;
  label: string;
  isNew: boolean;
};

export function moveSlotChoiceIsNew(value: string): boolean {
  return value.trim() === MOVE_SLOT_CHOICE_NEW;
}

/** 選んだ値から API へ送る slotRecordId を取り出す。新規作成・未選択は空文字 */
export function slotRecordIdFromChoice(value: string): string {
  const t = value.trim();
  if (!t || t === MOVE_SLOT_CHOICE_NEW) return "";
  return t;
}

/**
 * その日の空き枠を並べ、**末尾に「新しく作成する」**を置く。
 * 空き枠が無い日は「新しく作成する」だけになる。
 */
export function buildMoveSlotChoices(
  slots: readonly MoveTargetSlot[],
  targetDayKey: string,
): MoveSlotChoice[] {
  const ymd = formatDisplayYmd(targetDayKey);
  const out: MoveSlotChoice[] = slots.map((slot) => ({
    value: slot.recordId,
    // 施工会社が選ぶ材料になる。空の枠も「未設定」と出して隠さない
    label: `${ymd ? `${ymd} の` : ""}空き枠（施工会社: ${
      slot.contractorName.trim() || "未設定"
    }）`,
    isNew: false,
  }));
  out.push({
    value: MOVE_SLOT_CHOICE_NEW,
    label: "新しく作成する",
    isNew: true,
  });
  return out;
}

/** 施工業者の選択欄をどう扱うか */
export type MoveContractorInputState = {
  /** 欄を出すか。空き枠を選んだときは出さない（枠の施工会社が使われる） */
  show: boolean;
  /** 選択を必須にするか。一覧を引けていないときは必須にしない */
  required: boolean;
};

export function resolveMoveContractorInput(input: {
  slotChoice: string;
  optionsLoading: boolean;
  optionsConfigured: boolean;
  optionCount: number;
}): MoveContractorInputState {
  const show = moveSlotChoiceIsNew(input.slotChoice);
  if (!show) return { show: false, required: false };

  // 読み込み中は「引けない」と決めつけない。出揃うまでは必須のまま止める
  const usable = input.optionsConfigured && input.optionCount > 0;
  return { show: true, required: input.optionsLoading || usable };
}

/** 移動元と同じ日か（押し間違いとして弾く） */
export function moveTargetIsSameDay(
  targetDayKey: string,
  sourceDayKey: string,
): boolean {
  const t = targetDayKey.trim();
  return Boolean(t) && t === sourceDayKey.trim();
}

/**
 * 確認へ進めるか。
 * 枠の読み込み中・読み込み失敗は呼び出し側で別に弾く（理由を出し分けるため）。
 */
export function canConfirmMoveCase(input: {
  /** 案件と移動元の日付が揃っていて、ログインできている */
  canOpen: boolean;
  targetDayKey: string;
  sourceDayKey: string;
  slotChoice: string;
  /** 工事対応者をスタッフ名簿から選ぶ環境か */
  handlerRequired: boolean;
  handlerStaffId: string;
  contractorRequired: boolean;
  contractor: string;
}): boolean {
  if (!input.canOpen) return false;
  if (!input.targetDayKey.trim()) return false;
  if (moveTargetIsSameDay(input.targetDayKey, input.sourceDayKey)) return false;
  // 枠を使うのか作るのかを選んでいない
  if (!input.slotChoice.trim()) return false;
  if (input.handlerRequired && !input.handlerStaffId.trim()) return false;
  if (input.contractorRequired && !input.contractor.trim()) return false;
  return true;
}
