import { isReferralSourceRequiredByClub } from "@/lib/customer-info-form/options";
import { mergeStaffNameOptions } from "@/lib/staff-name-options";

/**
 * 紹介元の欄の形（テキスト / 単一選択）を決める。
 *
 * ■ 選択式にするのはトラーチ倶楽部の案件だけ
 * 判定は isReferralSourceRequiredByClub（必須の条件と同じ1関数）。
 * それ以外の案件はこれまでどおりテキスト。担当者を変えると欄の形が
 * 切り替わるが、値（values.referralSource）には触らない。
 *
 * ■ 選択肢は取引先会社一覧のトラーチ倶楽部加盟店（取引中）
 * 今入っている値が一覧に無ければ選択肢に足す（施工業者と同じく
 * mergeStaffNameOptions。既存データを壊さないため）。
 *
 * ■ 一覧が読めないときはテキストに戻す
 * 紹介元はトラーチ倶楽部の案件で必須なので、信販会社のように
 * 「読めないと選べない」にすると、その間トラーチ倶楽部の案件が
 * すべて保存できなくなる。読み込み失敗・未設定・0件のときは
 * テキスト入力に戻し、説明を出す。
 *
 * 保存・必須の判定は欄の形に関係なく schema の text のまま
 * （選択式でも送るのは同じ文字列）。
 */

/** 紹介元の選択肢の読み込み状態（画面の state） */
export type ReferralSourceOptionsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; options: string[] }
  | { status: "failed" };

/** 一覧を読めなかったとき（内部の事情は出さない） */
export const REFERRAL_SOURCE_OPTIONS_FAILED_NOTE =
  "選択肢を読み込めませんでした。手入力してください。";

/** 一覧を読み込んでいるあいだ（入力は止めない） */
export const REFERRAL_SOURCE_OPTIONS_LOADING_NOTE = "選択肢を読み込み中です。";

export type ReferralSourceFieldPresentation = {
  type: "text" | "select";
  /** 選択式のときの選択肢（今の値を含む・五十音順） */
  options: string[];
  /** 欄の下に出す説明。無ければ null */
  note: string | null;
};

const TEXT: ReferralSourceFieldPresentation = {
  type: "text",
  options: [],
  note: null,
};

export function referralSourceFieldPresentation(
  values: {
    apStaff?: string | null;
    clStaff?: string | null;
    referralSource?: string | null;
  },
  state: ReferralSourceOptionsState,
): ReferralSourceFieldPresentation {
  if (!isReferralSourceRequiredByClub(values)) return TEXT;

  if (state.status === "idle" || state.status === "loading") {
    return { ...TEXT, note: REFERRAL_SOURCE_OPTIONS_LOADING_NOTE };
  }
  if (state.status === "failed" || state.options.length === 0) {
    return { ...TEXT, note: REFERRAL_SOURCE_OPTIONS_FAILED_NOTE };
  }
  return {
    type: "select",
    options: mergeStaffNameOptions(state.options, values.referralSource ?? ""),
    note: null,
  };
}

/** 選択肢 API の応答から状態を決める。形が想定外なら failed（テキストに戻る） */
export function referralSourceOptionsStateFromResponse(
  ok: boolean,
  data: unknown,
): ReferralSourceOptionsState {
  if (!ok || !data || typeof data !== "object") return { status: "failed" };
  const d = data as { options?: unknown; configured?: unknown };
  if (d.configured === false || !Array.isArray(d.options)) {
    return { status: "failed" };
  }
  const options = d.options.filter(
    (o): o is string => typeof o === "string" && o.trim() !== "",
  );
  return { status: "ready", options };
}
