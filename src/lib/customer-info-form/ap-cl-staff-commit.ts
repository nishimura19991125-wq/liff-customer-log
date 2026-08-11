import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  commitStaffNameInput,
  isExactStaffName,
} from "@/lib/staff-name-options";

/**
 * 保存時に AP/CL担当者をどう扱うかの判定（純粋関数）。
 *
 * これまでは保存のたびに commitStaffNameInput を通していた。この関数は
 * 「完全一致 → その名前 / 不一致なら先頭候補 / 候補なし → 空」なので、
 * @pocket に入っている担当者が名簿の候補（AP/CL稼働が「稼働」の人だけ）に
 * 含まれていないと、**利用者が何も触っていなくても**別の人へすり替わるか
 * 空になる。退職者・稼働を落とした人が担当の既存レコードで起きる。
 *
 * そこで「読み込んだ値から変わっていない項目は、そのまま送る」ことにした。
 * 触った項目だけを名簿に合わせて確定する。
 *
 * 候補に無い名前を入力した場合も空にはしない。空にすると入力が黙って
 * 消えるので、値は残したうえで mismatch を立て、呼び出し側が保存を止めて
 * 利用者に知らせる。
 */

export type ApClStaffCommitResult = {
  /** 保存に使う値 */
  value: string;
  /** 名簿と完全一致しない。呼び出し側は保存を止めて知らせる */
  mismatch: boolean;
};

export function commitApClStaffForSave(input: {
  /** @pocket から読み込んだ値（未取得なら空文字） */
  loaded: string | undefined;
  /** 画面の現在値 */
  current: string | undefined;
  /** 名簿の候補。未取得のときは空配列 */
  options: readonly string[];
}): ApClStaffCommitResult {
  const current = input.current ?? "";
  const loadedNorm = normApClStaffName(input.loaded);
  const currentNorm = normApClStaffName(current);

  // 触っていない項目は一切加工しない。既存レコードの担当者を書き換えない
  if (currentNorm === loadedNorm) {
    return { value: current, mismatch: false };
  }

  const committed = commitStaffNameInput(input.options, currentNorm);
  // 候補が無くても入力を消さない。判断は mismatch 側に任せる
  const value = committed || currentNorm;

  const mismatch =
    Boolean(value.trim()) &&
    input.options.length > 0 &&
    !isExactStaffName(input.options, value);

  return { value, mismatch };
}
