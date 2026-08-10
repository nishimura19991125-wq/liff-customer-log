import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCustomerInfoDraft,
  clearCustomerInfoDraft,
  customerInfoDraftKey,
  CUSTOMER_INFO_DRAFT_KEY_PREFIX,
  CUSTOMER_INFO_DRAFT_TTL_MS,
  formatCustomerInfoDraftSavedAt,
  hashCustomerInfoValues,
  isCustomerInfoDraftExpired,
  loadCustomerInfoDraft,
  parseCustomerInfoDraft,
  purgeExpiredCustomerInfoDrafts,
  saveCustomerInfoDraft,
} from "@/lib/customer-info-draft";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

/** localStorage の代わり。Storage と同じ形だけ用意する */
class FakeStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  [name: string]: unknown;
}

/** 常に例外を投げるストレージ（プライベートブラウジング・容量超過の再現） */
class ThrowingStorage implements Storage {
  get length(): number {
    throw new Error("denied");
  }
  key(): string | null {
    throw new Error("denied");
  }
  getItem(): string | null {
    throw new Error("denied");
  }
  setItem(): void {
    throw new Error("QuotaExceededError");
  }
  removeItem(): void {
    throw new Error("denied");
  }
  clear(): void {
    throw new Error("denied");
  }
  [name: string]: unknown;
}

const NOW = 1_754_800_000_000;

function draftAt(
  recordId: string,
  savedAt: number,
  values: CustomerInfoFormValues = { customerName: "山田太郎" },
) {
  return buildCustomerInfoDraft({
    recordId,
    savedAt,
    baseHash: hashCustomerInfoValues({ customerName: "山田" }),
    values,
  });
}

describe("customerInfoDraftKey", () => {
  it("顧客ごとにキーが分かれる", () => {
    expect(customerInfoDraftKey("111")).toBe(
      `${CUSTOMER_INFO_DRAFT_KEY_PREFIX}111`,
    );
    expect(customerInfoDraftKey("111")).not.toBe(customerInfoDraftKey("222"));
  });

  it("別々の顧客の退避が混ざらない", () => {
    const s = new FakeStorage();
    saveCustomerInfoDraft(s, draftAt("111", NOW, { customerName: "山田太郎" }));
    saveCustomerInfoDraft(s, draftAt("222", NOW, { customerName: "鈴木花子" }));

    expect(loadCustomerInfoDraft(s, "111", NOW)?.values.customerName).toBe(
      "山田太郎",
    );
    expect(loadCustomerInfoDraft(s, "222", NOW)?.values.customerName).toBe(
      "鈴木花子",
    );

    // 片方を消してももう片方は残る
    clearCustomerInfoDraft(s, "111");
    expect(loadCustomerInfoDraft(s, "111", NOW)).toBeNull();
    expect(loadCustomerInfoDraft(s, "222", NOW)).not.toBeNull();
  });
});

describe("保存と復元", () => {
  it("保存した内容がそのまま復元できる", () => {
    const s = new FakeStorage();
    const values = {
      customerName: "山田太郎",
      prefecture: "東京都",
      phone: "090-1234-5678",
    };
    const saved = draftAt("111", NOW, values);
    expect(saveCustomerInfoDraft(s, saved)).toBe(true);

    const loaded = loadCustomerInfoDraft(s, "111", NOW);
    expect(loaded).not.toBeNull();
    expect(loaded?.values).toEqual(values);
    expect(loaded?.savedAt).toBe(NOW);
    expect(loaded?.baseHash).toBe(saved.baseHash);
  });

  it("壊れた JSON は復元候補にせず削除する", () => {
    const s = new FakeStorage();
    s.setItem(customerInfoDraftKey("111"), "{ broken");
    expect(loadCustomerInfoDraft(s, "111", NOW)).toBeNull();
    expect(s.getItem(customerInfoDraftKey("111"))).toBeNull();
  });

  it("形式のバージョンが違うものは受け付けない", () => {
    expect(
      parseCustomerInfoDraft(
        JSON.stringify({
          v: 99,
          recordId: "111",
          savedAt: NOW,
          baseHash: "x",
          values: {},
        }),
      ),
    ).toBeNull();
  });
});

describe("期限", () => {
  it("7日ちょうどで期限切れになる", () => {
    const d = draftAt("111", NOW);
    expect(isCustomerInfoDraftExpired(d, NOW)).toBe(false);
    expect(
      isCustomerInfoDraftExpired(d, NOW + CUSTOMER_INFO_DRAFT_TTL_MS - 1),
    ).toBe(false);
    expect(isCustomerInfoDraftExpired(d, NOW + CUSTOMER_INFO_DRAFT_TTL_MS)).toBe(
      true,
    );
  });

  it("期限切れのデータは復元候補にならず、その場で削除される", () => {
    const s = new FakeStorage();
    saveCustomerInfoDraft(s, draftAt("111", NOW));

    const later = NOW + CUSTOMER_INFO_DRAFT_TTL_MS + 1;
    expect(loadCustomerInfoDraft(s, "111", later)).toBeNull();
    expect(s.getItem(customerInfoDraftKey("111"))).toBeNull();
  });

  it("他の顧客の期限切れも前方一致で掃除する。期限内と無関係なキーは残す", () => {
    const s = new FakeStorage();
    saveCustomerInfoDraft(s, draftAt("111", NOW)); // 期限内
    saveCustomerInfoDraft(s, draftAt("222", NOW - CUSTOMER_INFO_DRAFT_TTL_MS - 1));
    saveCustomerInfoDraft(s, draftAt("333", NOW - CUSTOMER_INFO_DRAFT_TTL_MS - 1));
    s.setItem("other-app-key", "keep me");
    s.setItem(`${CUSTOMER_INFO_DRAFT_KEY_PREFIX}broken`, "{ broken");

    // 壊れているものも掃除の対象
    expect(purgeExpiredCustomerInfoDrafts(s, NOW)).toBe(3);
    expect(s.getItem(customerInfoDraftKey("111"))).not.toBeNull();
    expect(s.getItem(customerInfoDraftKey("222"))).toBeNull();
    expect(s.getItem(customerInfoDraftKey("333"))).toBeNull();
    expect(s.getItem(`${CUSTOMER_INFO_DRAFT_KEY_PREFIX}broken`)).toBeNull();
    expect(s.getItem("other-app-key")).toBe("keep me");
  });
});

describe("hashCustomerInfoValues（レコードの変更検出・J-3）", () => {
  it("同じ内容なら同じ。キーの並び順に依存しない", () => {
    expect(hashCustomerInfoValues({ a: "1", b: "2" })).toBe(
      hashCustomerInfoValues({ b: "2", a: "1" }),
    );
  });

  it("値が1つでも変わると変わる", () => {
    const before = hashCustomerInfoValues({ customerName: "山田太郎", city: "港区" });
    const after = hashCustomerInfoValues({ customerName: "山田次郎", city: "港区" });
    expect(after).not.toBe(before);
  });

  it("空文字と未設定は同じものとして扱う（API が空の列を省くことがある）", () => {
    expect(hashCustomerInfoValues({ a: "1", b: "" })).toBe(
      hashCustomerInfoValues({ a: "1" }),
    );
    expect(hashCustomerInfoValues({})).toBe(hashCustomerInfoValues(null));
  });

  it("退避中に他の人が更新した場合を検出できる", () => {
    const loadedWhenDrafting = { customerName: "山田太郎", city: "港区" };
    const draft = buildCustomerInfoDraft({
      recordId: "111",
      savedAt: NOW,
      baseHash: hashCustomerInfoValues(loadedWhenDrafting),
      values: { ...loadedWhenDrafting, phone: "090-1234-5678" },
    });

    // 誰も触っていない
    expect(draft.baseHash).toBe(hashCustomerInfoValues(loadedWhenDrafting));
    // 他の人が city を変えた
    expect(draft.baseHash).not.toBe(
      hashCustomerInfoValues({ customerName: "山田太郎", city: "渋谷区" }),
    );
  });
});

describe("localStorage が使えない環境（J-6）", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("storage が null でも例外にならない", () => {
    expect(saveCustomerInfoDraft(null, draftAt("111", NOW))).toBe(false);
    expect(loadCustomerInfoDraft(null, "111", NOW)).toBeNull();
    expect(purgeExpiredCustomerInfoDrafts(null, NOW)).toBe(0);
    expect(() => clearCustomerInfoDraft(null, "111")).not.toThrow();
  });

  it("storage が例外を投げても外へ漏れない", () => {
    const s = new ThrowingStorage();
    expect(saveCustomerInfoDraft(s, draftAt("111", NOW))).toBe(false);
    expect(loadCustomerInfoDraft(s, "111", NOW)).toBeNull();
    expect(purgeExpiredCustomerInfoDrafts(s, NOW)).toBe(0);
    expect(() => clearCustomerInfoDraft(s, "111")).not.toThrow();
  });

  it("警告に退避内容を載せない", () => {
    const s = new ThrowingStorage();
    saveCustomerInfoDraft(
      s,
      draftAt("111", NOW, { customerName: "山田太郎", phone: "090-1234-5678" }),
    );
    const logged = JSON.stringify(
      (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls,
    );
    expect(logged).not.toContain("山田太郎");
    expect(logged).not.toContain("090-1234-5678");
  });
});

describe("formatCustomerInfoDraftSavedAt", () => {
  it("月/日 時:分 で出す（JST 固定）", () => {
    // 2026-08-10 15:32 JST
    const ms = Date.UTC(2026, 7, 10, 6, 32);
    expect(formatCustomerInfoDraftSavedAt(ms)).toBe("8/10 15:32");
  });

  it("0時台もゼロ埋めする", () => {
    const ms = Date.UTC(2026, 7, 9, 15, 5); // 2026-08-10 00:05 JST
    expect(formatCustomerInfoDraftSavedAt(ms)).toBe("8/10 00:05");
  });

  it("不正な値は空文字", () => {
    expect(formatCustomerInfoDraftSavedAt(Number.NaN)).toBe("");
  });
});
