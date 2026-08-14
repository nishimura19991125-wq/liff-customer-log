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

/**
 * サーバ側の最終防衛（修正3／案F）。
 *
 * 上の commitApClStaffForSave は画面の状態に依存するため、画面を経由しない
 * 保存（施工依頼パネルの直接 PUT など）や、画面の値が壊れていた場合には
 * 効かない。そこでサーバでも「@pocket の現在値と同じなら送らない」を掛ける。
 * 送らなければ @pocket 側の値はそのまま残るので、担当者を壊しようがない。
 *
 * ■ 空欄の扱いについて（重要・将来の判断材料）
 * AP/CL担当者を**意図的に空にする運用は無い**ことを確認済みのため、
 * 空欄は「消したい」ではなく「値が取れていない・組み立てに失敗した」と
 * みなして送らない。
 * 将来、担当者を空欄に戻す運用が必要になったら、この判定
 * （reason: "empty" を send: false にしている箇所）が邪魔をする。
 * そのときは空欄化を明示的に伝える手段（専用フラグ等）を足すこと。
 * 「空欄を送れば消える」に戻すと、この防衛そのものが無くなる。
 */
export type ApClStaffPutDecision = {
  send: boolean;
  reason: "changed" | "unchanged" | "empty" | "unknown-current";
};

export function decideApClStaffPut(input: {
  /** @pocket に入っている現在値。読み取れなかったときは null */
  loaded: string | null;
  /** これから送ろうとしている値 */
  outgoing: string | undefined;
}): ApClStaffPutDecision {
  const outgoing = normApClStaffName(input.outgoing);

  // 空欄は送らない（上記「空欄の扱いについて」を参照）。
  // 現在値を読めたかどうかに関係なく、まず空欄を弾く
  if (!outgoing) return { send: false, reason: "empty" };

  // 現在値を読めていない。比較のしようがないので送る。
  // ここで送らない側に倒すと、@pocket が不調な間ずっと担当者を変更できなくなる
  if (input.loaded === null) return { send: true, reason: "unknown-current" };

  // 比較は normApClStaffName（NFKC・空白正規化）。全角半角・空白のゆれだけの
  // 差は「変わっていない」として扱う
  if (outgoing === normApClStaffName(input.loaded)) {
    return { send: false, reason: "unchanged" };
  }

  return { send: true, reason: "changed" };
}
