import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// liff-session.ts は LIFF SDK（ブラウザ前提）を読むので、node 環境用に差し替える
vi.mock("@line/liff", () => ({ default: {} }));

import { LIFF_PROFILE_CACHE_KEY } from "@/lib/liff-profile-cache-key";
import { clearLiffProfileCache } from "@/lib/liff-session";
import {
  clearStaffApiSessionCache,
  fetchStaffApiWithSessionCache,
  readStaffApiSessionCache,
  STAFF_API_SESSION_CACHE_KEY,
  writeStaffApiSessionCache,
} from "@/lib/staff-api-session-cache";

/**
 * 初回紐づけ直後にページ遷移すると紐づけ画面が再表示される不具合の再現と固定。
 *
 * 症状:
 *   紐づけ前に一度でもページを開くと、sessionStorage に boundStaff: null が
 *   保存される（TTL 30分）。紐づけに成功しても**このキャッシュは更新されない**
 *   （fetchStaffApiWithSessionCache はキャッシュ命中時に書き込みの手前で
 *   return するため）。次のページでフックが再マウントするとキャッシュから
 *   boundStaff: null を読み、未紐づけと判定して紐づけ画面が出る。
 *   savedAt から最大30分続く。
 *
 * 方針:
 *   紐づけ成功時にキャッシュを**破棄**する。更新にしないのは、bind の応答が
 *   boundStaff: {id, name} だけで department / staffRole を含まないため。
 *   応答の値で書き換えると欠けたまま30分保持されてしまう。
 */

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

/** 常に例外を投げるストレージ（プライベートブラウジング等の再現） */
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
    throw new Error("denied");
  }
  removeItem(): void {
    throw new Error("denied");
  }
  clear(): void {
    throw new Error("denied");
  }
  [name: string]: unknown;
}

const g = globalThis as unknown as {
  sessionStorage?: Storage;
  fetch?: typeof fetch;
};

const ID_TOKEN = "dummy-id-token";

/** /api/staff の応答を1回分返すモック */
function mockStaffResponse(body: unknown, status = 200): void {
  g.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

function fetchCallCount(): number {
  return (g.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls
    .length;
}

const UNBOUND = {
  staff: [{ id: "1", name: "スタッフA" }],
  boundStaff: null,
  bindingEnabled: true,
};

const BOUND = {
  staff: [{ id: "1", name: "スタッフA" }],
  boundStaff: {
    id: "1",
    name: "スタッフA",
    department: "営業部",
    staffRole: "ap" as const,
  },
  bindingEnabled: true,
};

beforeEach(() => {
  g.sessionStorage = new FakeStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete g.sessionStorage;
  delete g.fetch;
});

describe("★ 再現：紐づけ成功後もキャッシュが古いままだと未紐づけに見える", () => {
  it("★ 破棄しないと、次の取得で boundStaff: null が返り続ける", async () => {
    // ① 紐づけ前にページを開く → boundStaff: null がキャッシュされる
    mockStaffResponse(UNBOUND);
    const first = await fetchStaffApiWithSessionCache(ID_TOKEN);
    expect(first.fromCache).toBe(false);
    expect(first.data.boundStaff).toBeNull();
    expect(readStaffApiSessionCache()?.boundStaff).toBeNull();

    // ② 紐づけが成功した → キャッシュを破棄する
    clearStaffApiSessionCache();

    // ③ 次のページでの取得。@pocket 側は紐づけ済みを返す
    mockStaffResponse(BOUND);
    const second = await fetchStaffApiWithSessionCache(ID_TOKEN);

    // 破棄していなければ fromCache: true で boundStaff: null が返る（＝不具合）
    expect(second.fromCache).toBe(false);
    expect(second.data.boundStaff?.name).toBe("スタッフA");
    expect(fetchCallCount()).toBe(1);
  });

  it("★ 破棄しなければ古い値が返ることを対比で示す（不具合そのもの）", async () => {
    mockStaffResponse(UNBOUND);
    await fetchStaffApiWithSessionCache(ID_TOKEN);

    // 破棄せずに取り直すと、ネットワークを介さず古い boundStaff が返る
    mockStaffResponse(BOUND);
    const again = await fetchStaffApiWithSessionCache(ID_TOKEN);
    expect(again.fromCache).toBe(true);
    expect(again.data.boundStaff).toBeNull();
    expect(fetchCallCount()).toBe(0);
  });
});

describe("clearStaffApiSessionCache", () => {
  it("★ キャッシュが消える", () => {
    writeStaffApiSessionCache({
      staff: UNBOUND.staff,
      boundStaff: null,
      bindingEnabled: true,
    });
    expect(readStaffApiSessionCache()).not.toBeNull();

    clearStaffApiSessionCache();
    expect(readStaffApiSessionCache()).toBeNull();
  });

  it("★ 期限切れを許す読み取りでも消えている（残骸が残らない）", () => {
    writeStaffApiSessionCache({
      staff: UNBOUND.staff,
      boundStaff: null,
      bindingEnabled: true,
    });
    clearStaffApiSessionCache();
    expect(readStaffApiSessionCache(true)).toBeNull();
    expect(g.sessionStorage?.getItem(STAFF_API_SESSION_CACHE_KEY)).toBeNull();
  });

  it("★ 破棄後の取得は実際に /api/staff を呼ぶ", async () => {
    writeStaffApiSessionCache({
      staff: UNBOUND.staff,
      boundStaff: null,
      bindingEnabled: true,
    });
    clearStaffApiSessionCache();

    mockStaffResponse(BOUND);
    const r = await fetchStaffApiWithSessionCache(ID_TOKEN);
    expect(fetchCallCount()).toBe(1);
    expect(r.fromCache).toBe(false);
    expect(r.data.boundStaff?.department).toBe("営業部");
    expect(r.data.boundStaff?.staffRole).toBe("ap");
  });

  it("キャッシュが無い状態で呼んでも例外にならない", () => {
    expect(() => clearStaffApiSessionCache()).not.toThrow();
    expect(readStaffApiSessionCache()).toBeNull();
  });

  it("sessionStorage が使えない環境でも例外にならない", () => {
    delete g.sessionStorage;
    expect(() => clearStaffApiSessionCache()).not.toThrow();
  });

  it("sessionStorage が例外を投げる環境でも例外にならない", () => {
    g.sessionStorage = new ThrowingStorage();
    expect(() => clearStaffApiSessionCache()).not.toThrow();
  });
});

describe("clearLiffProfileCache（再ログイン時）", () => {
  it("★ プロフィールと staff キャッシュの両方が消える", () => {
    g.sessionStorage?.setItem(LIFF_PROFILE_CACHE_KEY, JSON.stringify({ userId: "u" }));
    writeStaffApiSessionCache({
      staff: UNBOUND.staff,
      boundStaff: null,
      bindingEnabled: true,
    });

    clearLiffProfileCache();

    expect(g.sessionStorage?.getItem(LIFF_PROFILE_CACHE_KEY)).toBeNull();
    expect(readStaffApiSessionCache(true)).toBeNull();
  });

  it("★ 消えたあとの取得は /api/staff を呼ぶ", async () => {
    writeStaffApiSessionCache({
      staff: UNBOUND.staff,
      boundStaff: null,
      bindingEnabled: true,
    });
    clearLiffProfileCache();

    mockStaffResponse(BOUND);
    const r = await fetchStaffApiWithSessionCache(ID_TOKEN);
    expect(fetchCallCount()).toBe(1);
    expect(r.fromCache).toBe(false);
  });

  it("キャッシュが無い状態でも例外にならない", () => {
    expect(() => clearLiffProfileCache()).not.toThrow();
  });

  it("sessionStorage が例外を投げても staff キャッシュの破棄まで到達する", () => {
    // プロフィール側の removeItem が投げても、後続が呼ばれること
    g.sessionStorage = new ThrowingStorage();
    expect(() => clearLiffProfileCache()).not.toThrow();
  });
});

describe("キャッシュが無い状態でも従来どおり動く", () => {
  it("初回取得は /api/staff を呼び、応答をキャッシュする", async () => {
    mockStaffResponse(BOUND);
    const r = await fetchStaffApiWithSessionCache(ID_TOKEN);
    expect(r.fromCache).toBe(false);
    expect(fetchCallCount()).toBe(1);
    expect(readStaffApiSessionCache()?.boundStaff?.name).toBe("スタッフA");
  });

  it("2回目はキャッシュから返す（従来どおりの 429 連打抑止）", async () => {
    mockStaffResponse(BOUND);
    await fetchStaffApiWithSessionCache(ID_TOKEN);
    const second = await fetchStaffApiWithSessionCache(ID_TOKEN);
    expect(second.fromCache).toBe(true);
    expect(fetchCallCount()).toBe(1);
  });

  it("department / staffRole もキャッシュに残る", async () => {
    mockStaffResponse(BOUND);
    await fetchStaffApiWithSessionCache(ID_TOKEN);
    const cached = readStaffApiSessionCache();
    expect(cached?.boundStaff?.department).toBe("営業部");
    expect(cached?.boundStaff?.staffRole).toBe("ap");
  });
});
