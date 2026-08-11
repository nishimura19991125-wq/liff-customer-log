import { describe, expect, it } from "vitest";

import { commitApClStaffForSave } from "@/lib/customer-info-form/ap-cl-staff-commit";

/** 名簿の候補（AP/CL稼働が「稼働」の人だけが入る） */
const ROSTER = ["冨田菜摘", "山田太郎", "山田花子", "鈴木一郎"];

describe("commitApClStaffForSave（既存レコードの再編集）", () => {
  it("触っていなければ @pocket の値をそのまま返す", () => {
    const r = commitApClStaffForSave({
      loaded: "山田太郎",
      current: "山田太郎",
      options: ROSTER,
    });
    expect(r.value).toBe("山田太郎");
    expect(r.mismatch).toBe(false);
  });

  it("★ 名簿の候補に無い担当者でも、触っていなければ書き換えない", () => {
    // 退職した・AP/CL稼働を落とした担当者。以前は先頭候補へすり替わるか
    // 空になっていた
    const r = commitApClStaffForSave({
      loaded: "退職太郎",
      current: "退職太郎",
      options: ROSTER,
    });
    expect(r.value).toBe("退職太郎");
    expect(r.mismatch).toBe(false);
  });

  it("★ 部分一致する別人がいても、触っていなければ引き寄せられない", () => {
    // 「山田」は 山田太郎 / 山田花子 の両方に部分一致する。
    // 以前は先頭候補（山田太郎）に確定していた
    const r = commitApClStaffForSave({
      loaded: "山田",
      current: "山田",
      options: ROSTER,
    });
    expect(r.value).toBe("山田");
    expect(r.mismatch).toBe(false);
  });

  it("空欄のままなら空欄。勝手に誰かを入れない", () => {
    const r = commitApClStaffForSave({
      loaded: "",
      current: "",
      options: ROSTER,
    });
    expect(r.value).toBe("");
    expect(r.mismatch).toBe(false);
  });

  it("読み込み値が未取得（undefined）でも現在値が空なら触らない", () => {
    const r = commitApClStaffForSave({
      loaded: undefined,
      current: "",
      options: ROSTER,
    });
    expect(r.value).toBe("");
    expect(r.mismatch).toBe(false);
  });

  it("全角半角・空白のゆれだけなら「触っていない」とみなす", () => {
    const r = commitApClStaffForSave({
      loaded: "山田 太郎",
      current: "山田　太郎",
      options: ROSTER,
    });
    expect(r.value).toBe("山田　太郎");
    expect(r.mismatch).toBe(false);
  });
});

describe("commitApClStaffForSave（利用者が編集したとき）", () => {
  it("名簿と完全一致する名前はそのまま確定する", () => {
    const r = commitApClStaffForSave({
      loaded: "山田太郎",
      current: "鈴木一郎",
      options: ROSTER,
    });
    expect(r.value).toBe("鈴木一郎");
    expect(r.mismatch).toBe(false);
  });

  it("入力途中の文字列は先頭候補に確定する（従来どおり）", () => {
    const r = commitApClStaffForSave({
      loaded: "",
      current: "冨田",
      options: ROSTER,
    });
    expect(r.value).toBe("冨田菜摘");
    expect(r.mismatch).toBe(false);
  });

  it("候補に無い名前を入力しても空にせず、保存を止める合図を返す", () => {
    const r = commitApClStaffForSave({
      loaded: "山田太郎",
      current: "存在しない人",
      options: ROSTER,
    });
    // 以前は "" になって入力が黙って消えていた
    expect(r.value).toBe("存在しない人");
    expect(r.mismatch).toBe(true);
  });

  it("担当者を消したときは空で保存でき、止めない", () => {
    const r = commitApClStaffForSave({
      loaded: "山田太郎",
      current: "",
      options: ROSTER,
    });
    expect(r.value).toBe("");
    expect(r.mismatch).toBe(false);
  });

  it("名簿がまだ読めていないときは入力をそのまま通す", () => {
    const r = commitApClStaffForSave({
      loaded: "",
      current: "誰か",
      options: [],
    });
    expect(r.value).toBe("誰か");
    expect(r.mismatch).toBe(false);
  });
});

describe("commitApClStaffForSave（新規登録）", () => {
  it("読み込み値が無い状態から候補を選べる（初期値の挙動を壊さない）", () => {
    const r = commitApClStaffForSave({
      loaded: "",
      current: "冨田菜摘",
      options: ROSTER,
    });
    expect(r.value).toBe("冨田菜摘");
    expect(r.mismatch).toBe(false);
  });
});
