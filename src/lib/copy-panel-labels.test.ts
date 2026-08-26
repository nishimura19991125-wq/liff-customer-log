import { describe, expect, it } from "vitest";

import {
  showsConstructionRequestStatusHint,
  CONSTRUCTION_REQUEST_STATUS_HINT,
  COPY_BUTTON_LABEL,
} from "@/lib/copy-panel-labels";
import { CONSTRUCTION_REQUEST_STATUS_DONE } from "@/lib/construction-request-template";

describe("コピーパネルのボタン文言", () => {
  it("★ 3パネル共通で「コピー」", () => {
    expect(COPY_BUTTON_LABEL).toBe("コピー");
  });

  it("外側の開閉トグル（送る／閉じる）とは別の文言", () => {
    // 外側はコピーを実行しないので、同じ文言にしてはいけない
    expect(COPY_BUTTON_LABEL).not.toBe("送る");
    expect(COPY_BUTTON_LABEL).not.toBe("閉じる");
  });
});

describe("新規施工依頼の補足文", () => {
  it("★ ステータスが「済」になることを伝える", () => {
    expect(CONSTRUCTION_REQUEST_STATUS_HINT).toBe(
      "施工依頼ステータスが「済」になります",
    );
  });

  it("★ 未「済」なら出す", () => {
    expect(showsConstructionRequestStatusHint("未")).toBe(true);
    expect(showsConstructionRequestStatusHint("")).toBe(true);
    expect(showsConstructionRequestStatusHint(undefined)).toBe(true);
  });

  it("★ 既に「済」なら出さない（更新が起きないため）", () => {
    expect(showsConstructionRequestStatusHint(CONSTRUCTION_REQUEST_STATUS_DONE)).toBe(
      false,
    );
    expect(showsConstructionRequestStatusHint("済")).toBe(false);
  });

  it("前後の空白があっても「済」と判定する", () => {
    expect(showsConstructionRequestStatusHint(" 済 ")).toBe(false);
  });
});
