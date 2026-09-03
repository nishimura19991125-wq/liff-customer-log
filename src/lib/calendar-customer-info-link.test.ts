import { describe, expect, it } from "vitest";

import {
  CUSTOMER_INFO_LINK_GENERIC_ERROR_MESSAGE,
  CUSTOMER_INFO_LINK_NOT_FOUND_MESSAGE,
  CUSTOMER_INFO_LINK_RATE_LIMITED_MESSAGE,
  CUSTOMER_INFO_RECORD_ID_PATH,
  customerInfoEditHref,
  customerInfoLinkOutcome,
  customerInfoRecordIdLookupPath,
  shouldShowCustomerInfoLink,
} from "@/lib/calendar-customer-info-link";
import { CONSTRUCTION_CALENDAR_PAGE_CONFIG } from "@/lib/liff-calendar-page-config";

/**
 * 案件カード → お客様情報（契約情報入力フォーム）の導線。
 *
 * 表示条件と遷移判定を1箇所に集める。画面側で書き直すと、
 * 出ていないボタンの経路が生き残る形のズレが起きる。
 */

const T = "T00003420";

describe("設定での出し分け", () => {
  it("★ 工事カレンダーでは出す", () => {
    expect(CONSTRUCTION_CALENDAR_PAGE_CONFIG.showCustomerInfoLink).toBe(true);
    expect(
      shouldShowCustomerInfoLink(CONSTRUCTION_CALENDAR_PAGE_CONFIG, T),
    ).toBe(true);
  });

  it("★ 未指定の画面では出さない（既定は false）", () => {
    // 共用部品なので、明示的に true にした画面だけに出す。
    // 比較対象だったコミュニケーションブリッジは削除したが、
    // 既定で出ないことは画面が増えたときのために固定しておく
    expect(shouldShowCustomerInfoLink({}, T)).toBe(false);
    expect(shouldShowCustomerInfoLink({ showCustomerInfoLink: undefined }, T)).toBe(
      false,
    );
  });

  it("false を明示した画面でも出さない", () => {
    expect(shouldShowCustomerInfoLink({ showCustomerInfoLink: false }, T)).toBe(
      false,
    );
  });

  it("@pocket の導線（showCaseAccessLink）とは別の設定", () => {
    // 工事カレンダーは @pocket は閉じたまま、アプリ内の導線だけ開ける
    expect(CONSTRUCTION_CALENDAR_PAGE_CONFIG.showCaseAccessLink).toBe(false);
    expect(CONSTRUCTION_CALENDAR_PAGE_CONFIG.showCustomerInfoLink).toBe(true);
  });
});

describe("★ T番号が無いときはボタンを出さない", () => {
  it.each([undefined, "", "   "])("T番号が %o なら false", (tNumber) => {
    expect(
      shouldShowCustomerInfoLink(CONSTRUCTION_CALENDAR_PAGE_CONFIG, tNumber),
    ).toBe(false);
  });

  it("空枠など T番号を持たない案件では、設定が true でも出ない", () => {
    expect(
      shouldShowCustomerInfoLink(CONSTRUCTION_CALENDAR_PAGE_CONFIG, undefined),
    ).toBe(false);
  });
});

describe("呼び出し先と遷移先", () => {
  it("変換 API は段階1で追加したパス", () => {
    expect(CUSTOMER_INFO_RECORD_ID_PATH).toBe("/api/customer-info/record-id");
    expect(customerInfoRecordIdLookupPath(T)).toBe(
      "/api/customer-info/record-id?tNumber=T00003420",
    );
  });

  it("T番号はエンコードして渡す（前後の空白は落とす）", () => {
    expect(customerInfoRecordIdLookupPath(" T 1&2 ")).toBe(
      "/api/customer-info/record-id?tNumber=T%201%262",
    );
  });

  it("遷移先は既存の導線（顧客一覧・ホーム）と同じ形", () => {
    expect(customerInfoEditHref("rec-123")).toBe(
      "/customer-info?recordId=rec-123",
    );
    expect(customerInfoEditHref("a b&c")).toBe(
      "/customer-info?recordId=a%20b%26c",
    );
  });
});

describe("応答 → 画面の動き", () => {
  it("200 なら遷移する", () => {
    expect(customerInfoLinkOutcome(200, { recordId: "rec-123" })).toEqual({
      kind: "open",
      href: "/customer-info?recordId=rec-123",
    });
  });

  it("★ 404 は遷移しない（見つからない旨を出す）", () => {
    const out = customerInfoLinkOutcome(404, {
      error: CUSTOMER_INFO_LINK_NOT_FOUND_MESSAGE,
    });

    expect(out).toEqual({
      kind: "error",
      text: "該当するお客様情報が見つかりません",
    });
  });

  it("503 はサーバの固定文言をそのまま出す", () => {
    const out = customerInfoLinkOutcome(503, {
      error: "お客様情報との連携が設定されていません。管理者にお問い合わせください。",
    });

    expect(out).toEqual({
      kind: "error",
      text: "お客様情報との連携が設定されていません。管理者にお問い合わせください。",
    });
  });

  it("503 で文言が無ければ既定の文言", () => {
    expect(customerInfoLinkOutcome(503, null)).toEqual({
      kind: "error",
      text: CUSTOMER_INFO_LINK_GENERIC_ERROR_MESSAGE,
    });
  });

  it("429 は待つよう伝える", () => {
    expect(customerInfoLinkOutcome(429, null)).toEqual({
      kind: "error",
      text: CUSTOMER_INFO_LINK_RATE_LIMITED_MESSAGE,
    });
  });

  it.each([400, 401, 500, 502])("%i はまとめて既定の文言", (status) => {
    expect(customerInfoLinkOutcome(status, null)).toEqual({
      kind: "error",
      text: CUSTOMER_INFO_LINK_GENERIC_ERROR_MESSAGE,
    });
  });

  it("★ 200 でも recordId が無ければ遷移しない", () => {
    // 遷移先が作れない。/customer-info?recordId= へ飛ばさない
    for (const body of [null, {}, { recordId: "" }, { recordId: "  " }]) {
      expect(customerInfoLinkOutcome(200, body), JSON.stringify(body)).toEqual({
        kind: "error",
        text: CUSTOMER_INFO_LINK_GENERIC_ERROR_MESSAGE,
      });
    }
  });

  it("★ 遷移するのは kind:open のときだけ（エラーは href を持たない）", () => {
    const statuses = [200, 404, 429, 503, 500];
    for (const status of statuses) {
      const out = customerInfoLinkOutcome(status, null);
      if (out.kind === "error") {
        expect(out, `status=${status}`).not.toHaveProperty("href");
      }
    }
  });
});
