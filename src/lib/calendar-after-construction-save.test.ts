import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 連携のあとに T番号 を工事アプリへ書き戻す判定。
 *
 * 実機で「工事登録アプリに T番号 が入らない」が出た。原因は書き戻しの
 * 判定が `syncedTNumber !== constructionUniqueKey` だったこと。
 * 従来の呼び出し元は constructionUniqueKey に**工事レコードから読んだ値**を
 * 渡していたので判定できていたが、お客様情報を起点にする経路
 * （assign-customer-case）は突合のために**お客様情報側の T番号**を渡す。
 * それが一致してしまい、書き戻しが丸ごと飛んでいた。
 *
 * ここで固定するのは次の2つ。
 *   - constructionRecordTNumber に空を渡せば必ず書き戻す
 *   - 省略した従来の呼び出しは挙動が変わらない
 */

const T_FIELD = "field-1";
const AKI_FIELD = "field-101";

const h = vi.hoisted(() => ({
  writes: [] as Array<{ recordId?: string; payload: Record<string, unknown> }>,
  syncResult: {} as Record<string, unknown>,
  patchCalls: 0,
  newCaseNotifications: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/sync-construction-to-customer-info", () => ({
  syncConstructionRecordToCustomerInfoApp: async () => h.syncResult,
}));

vi.mock("@/lib/atpocket-write-with-import-key", () => ({
  writePocketRecordWithImportKey: async (opts: {
    recordId?: string;
    payload: Record<string, unknown>;
  }) => {
    h.writes.push({
      ...(opts.recordId ? { recordId: opts.recordId } : {}),
      payload: opts.payload,
    });
  },
}));

vi.mock("@/lib/calendar-record-patch-server", () => ({
  buildCalendarPatchAfterConstructionSave: async () => {
    h.patchCalls += 1;
    return null;
  },
}));

vi.mock("@/lib/new-case-notification-server", () => ({
  notifyNewCaseCreated: async (input: Record<string, unknown>) => {
    h.newCaseNotifications.push(input);
    return { kind: "sent" };
  },
}));

vi.mock("@/lib/calendar-kojo", () => ({
  resolveConstructionTNumberFieldId: () => T_FIELD,
  resolveConstructionImportKeyFieldId: () => AKI_FIELD,
}));

const { finalizeConstructionCalendarSave } = await import(
  "@/lib/calendar-after-construction-save"
);

const BASE = {
  calAppId: "cal-1",
  constructionRecordId: "con-1",
  customerName: "山田 太郎",
  constructionFields: [],
  calendarAuth: { apiKey: "k" },
};

beforeEach(() => {
  h.writes.length = 0;
  h.patchCalls = 0;
  h.newCaseNotifications.length = 0;
  h.syncResult = { kind: "synced", tNumber: "T00003420" };
});

describe("T番号の書き戻し", () => {
  it("★ constructionRecordTNumber が空なら、突合キーと同じでも書き戻す", async () => {
    await finalizeConstructionCalendarSave({
      ...BASE,
      // お客様情報側の T番号（突合用）
      constructionUniqueKey: "T00003420",
      // 工事レコードには入っていない
      constructionRecordTNumber: "",
      constructionImportKey: "A0001",
    });

    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]?.recordId).toBe("con-1");
    expect(h.writes[0]?.payload[T_FIELD]).toBe("T00003420");
    // 取込キー（Aki番号）も同送する
    expect(h.writes[0]?.payload[AKI_FIELD]).toBe("A0001");
  });

  it("★ 工事レコードに同じ T番号 が入っていれば書き戻さない", async () => {
    await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "T00003420",
      constructionRecordTNumber: "T00003420",
    });

    expect(h.writes).toEqual([]);
  });

  it("★ 省略した従来の呼び出しは挙動が変わらない（一致なら書かない）", async () => {
    await finalizeConstructionCalendarSave({
      ...BASE,
      // 従来の呼び出し元は工事レコードから読んだ値をここへ渡していた
      constructionUniqueKey: "T00003420",
    });

    expect(h.writes).toEqual([]);
  });

  it("省略した呼び出しで値が違えば従来どおり書き戻す", async () => {
    await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "",
    });

    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]?.payload[T_FIELD]).toBe("T00003420");
  });

  it("連携が失敗したときは書き戻さない", async () => {
    h.syncResult = { kind: "failed", error: "boom" };

    const res = await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "T00003420",
      constructionRecordTNumber: "",
    });

    expect(res.status).toBe(502);
    expect(h.writes).toEqual([]);
  });

  it("連携が T番号 を返さなければ書き戻さない", async () => {
    h.syncResult = { kind: "synced" };

    await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "T00003420",
      constructionRecordTNumber: "",
    });

    expect(h.writes).toEqual([]);
  });
});

/**
 * カレンダーの即時反映パッチを組み立てない指定（第1段階の速度改善）。
 *
 * 工事日の移動のパネルは onSaved(null) を呼んで必ず再取得するので、
 * patch を組み立てても捨てられる。@pocket の GET を1回節約する。
 * **既定は従来どおり組み立てる**（他の経路は patch を使っている）。
 */
describe("カレンダーパッチの組み立て", () => {
  it("★ 既定では組み立てる（他の経路は従来どおり）", async () => {
    await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "T00003420",
      viewYear: 2026,
      viewMonth: 12,
    });

    expect(h.patchCalls).toBe(1);
  });

  it("★ skipCalendarPatch を渡すと組み立てない", async () => {
    await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "T00003420",
      viewYear: 2026,
      viewMonth: 12,
      skipCalendarPatch: true,
    });

    expect(h.patchCalls).toBe(0);
  });

  it("組み立てなくても応答は成功のまま", async () => {
    const res = await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "T00003420",
      skipCalendarPatch: true,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; calendarPatch?: unknown };
    expect(body.ok).toBe(true);
    expect(body.calendarPatch).toBeUndefined();
  });
});

/**
 * E案: 連携の監査ログと T番号 の書き戻しを並走させる。
 *
 * 別のアプリの別のレコードを触るだけで順序に意味が無い。
 * ここで固定するのは**必ず書き切ってから返すこと**と、
 * 書き戻しを監査ログの完了まで待たないこと。
 */
describe("監査ログの合流（E案）", () => {
  /** resolve を外から呼べる Promise */
  function deferred() {
    let done = false;
    let release: () => void = () => {};
    const promise = new Promise<void>((r) => {
      release = () => {
        done = true;
        r();
      };
    });
    return { promise, release, isDone: () => done };
  }

  it("★ 監査ログを書き切ってから返す", async () => {
    const audit = deferred();
    h.syncResult = {
      kind: "synced",
      tNumber: "T00003420",
      pendingAudit: audit.promise,
    };

    let finished = false;
    const running = finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "T00003420",
      constructionRecordTNumber: "",
    }).then((res) => {
      finished = true;
      return res;
    });

    // 監査ログが終わるまで finalize は返らない
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);

    audit.release();
    await running;
    expect(finished).toBe(true);
    expect(audit.isDone()).toBe(true);
  });

  it("★ 書き戻しは監査ログの完了を待たない（並走している）", async () => {
    const audit = deferred();
    h.syncResult = {
      kind: "synced",
      tNumber: "T00003420",
      pendingAudit: audit.promise,
    };

    const running = finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "T00003420",
      constructionRecordTNumber: "",
    });

    // 監査ログを止めたままでも、書き戻しは進んでいる
    await vi.waitFor(() => expect(h.writes).toHaveLength(1));
    expect(audit.isDone()).toBe(false);

    audit.release();
    await running;
  });

  it("★ 連携が監査ログを返さなくても落ちない（後方互換）", async () => {
    h.syncResult = { kind: "synced", tNumber: "T00003420" };

    const res = await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "T00003420",
      constructionRecordTNumber: "",
    });

    expect(res.status).toBe(200);
    expect(h.writes).toHaveLength(1);
  });

  it("★ 連携が skipped でも落ちない", async () => {
    h.syncResult = { kind: "skipped" };

    const res = await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "T00003420",
      constructionRecordTNumber: "",
    });

    expect(res.status).toBe(200);
    // 書き戻す T番号 が無いので書かない
    expect(h.writes).toHaveLength(0);
  });
});

/**
 * 新規案件通知を送るのは、T番号 を新規発行する経路だけ。
 *
 * この後処理は新規登録・空き枠入力・未定案件の割り当て・工事日の移動が
 * 共通で通る。ここで既定が「送らない」でなくなると、既存の T番号 を
 * 使い回すだけの操作にまで通知が飛ぶ。
 */
describe("新規案件通知", () => {
  it("★ 既定では enabled:false で呼ぶ（空き枠入力・割り当て・工事日の移動）", async () => {
    await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "T00003420",
    });

    // 送らないと決めた理由をログに残させるため、握り潰さず必ず呼ぶ
    expect(h.newCaseNotifications).toEqual([
      {
        source: "finalize",
        enabled: false,
        tNumber: "T00003420",
        customerName: "山田 太郎",
        lineUserId: undefined,
      },
    ]);
  });

  it("★ notifyNewCase を渡した経路だけ enabled:true で呼ぶ（新規登録）", async () => {
    await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "",
      lineUserId: "U-line-1",
      notifyNewCase: true,
    });

    expect(h.newCaseNotifications).toEqual([
      {
        source: "finalize",
        enabled: true,
        tNumber: "T00003420",
        customerName: "山田 太郎",
        lineUserId: "U-line-1",
      },
    ]);
  });

  it("★ 連携が T番号 を返さなくても呼ぶ（空で渡し、送信側が理由を残す）", async () => {
    h.syncResult = { kind: "synced" };

    await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "",
      notifyNewCase: true,
    });

    expect(h.newCaseNotifications).toEqual([
      {
        source: "finalize",
        enabled: true,
        // 連携が読めなければ undefined のまま渡す（送信側が空と判定する）
        tNumber: undefined,
        customerName: "山田 太郎",
        lineUserId: undefined,
      },
    ]);
  });

  it("連携が失敗したときは呼ばない（登録が成立していない）", async () => {
    h.syncResult = { kind: "failed", error: "boom" };

    const res = await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "",
      notifyNewCase: true,
    });

    expect(res.status).toBe(502);
    expect(h.newCaseNotifications).toEqual([]);
  });
});

/**
 * 書き戻しが飛んだことを残す。
 *
 * 通知が落ちていたのと同じ原因（T番号 が空）でここも落ちるが、通知と違い
 * 誰も気付けない。工事アプリの T番号 が空のまま残ると、カレンダー表示・
 * 工事報告アプリとの突合・キャンセル処理に後から効いてくる。
 */
describe("T番号 が空のときの記録", () => {
  it("★ 書き戻せないことを error に残す", async () => {
    h.syncResult = { kind: "synced" };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "",
    });

    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("書き戻せません");
    expect(logged).toContain("con-1");
    expect(h.writes).toEqual([]);

    errorSpy.mockRestore();
  });

  it("T番号 が取れていれば残さない（正常時にログを汚さない）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await finalizeConstructionCalendarSave({
      ...BASE,
      constructionUniqueKey: "",
    });

    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("書き戻せません");
    expect(h.writes).toHaveLength(1);

    errorSpy.mockRestore();
  });
});
