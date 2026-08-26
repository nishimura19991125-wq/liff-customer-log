import { describe, expect, it } from "vitest";

import { pickCreatedApoRecordId } from "@/lib/apo-record-lookup";

/**
 * 作成直後のレコードを「増えた1件」で特定する判定。
 *
 * @pocket のこのアプリは POST /records で ID を返さない。
 * かといってお客様名で当てにいくと、同姓同名や再登録のときに
 * **既存の別レコードを掴む**。掴んだ先に添付が付き共有リンクが
 * 上書きされるので、実データを壊す事故になる。
 *
 * 迷ったら特定しない（フェイルクローズ）ことをここで固定する。
 */

const snap = (recordIds: string[], reliable = true) => ({
  recordIds,
  reliable,
});

describe("pickCreatedApoRecordId", () => {
  it("★ ちょうど1件増えていればそれを採る", () => {
    expect(pickCreatedApoRecordId(snap(["10", "11"]), snap(["10", "11", "12"])))
      .toBe("12");
  });

  it("元が0件でも1件増えていれば採る（そのお客様の初回登録）", () => {
    expect(pickCreatedApoRecordId(snap([]), snap(["12"]))).toBe("12");
  });

  it("★ 既存レコードは掴まない（増えていなければ null）", () => {
    // 同姓同名の既存レコードがあっても、作成前の一覧に入っているので選ばれない
    expect(pickCreatedApoRecordId(snap(["10"]), snap(["10"]))).toBeNull();
  });

  it("★ 作成した行がまだ一覧に見えないときも掴まない", () => {
    // 反映待ちで 0 件増。ここで既存の 10 を採ると別レコードに添付してしまう
    expect(pickCreatedApoRecordId(snap(["10"]), snap(["10"]))).toBeNull();
  });

  it("★ 2件以上増えていたら特定しない", () => {
    // 同時に別の誰かが同名で登録した場合。どちらが自分の分か分からない
    expect(
      pickCreatedApoRecordId(snap(["10"]), snap(["10", "11", "12"])),
    ).toBeNull();
  });

  it("減っていても採らない", () => {
    expect(pickCreatedApoRecordId(snap(["10", "11"]), snap(["10"]))).toBeNull();
  });

  it("★ 一覧が信用できないときは採らない", () => {
    // 上限に達して取りこぼした可能性がある一覧では差分を判断できない
    expect(
      pickCreatedApoRecordId(snap(["10"], false), snap(["10", "12"])),
    ).toBeNull();
    expect(
      pickCreatedApoRecordId(snap(["10"]), snap(["10", "12"], false)),
    ).toBeNull();
  });

  it("★ 一覧を取れなかったときは採らない", () => {
    expect(pickCreatedApoRecordId(null, snap(["10", "12"]))).toBeNull();
    expect(pickCreatedApoRecordId(snap(["10"]), null)).toBeNull();
    expect(pickCreatedApoRecordId(null, null)).toBeNull();
  });

  it("同じ ID が重複して返っても1件として数える", () => {
    expect(
      pickCreatedApoRecordId(snap(["10"]), snap(["10", "12", "12"])),
    ).toBe("12");
  });
});
