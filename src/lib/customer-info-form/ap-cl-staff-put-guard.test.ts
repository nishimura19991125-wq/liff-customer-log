import { beforeEach, describe, expect, it, vi } from "vitest";

import { decideApClStaffPut } from "@/lib/customer-info-form/ap-cl-staff-commit";
import { CUSTOMER_INFO_FORM_FIELDS } from "@/lib/customer-info-form/schema";
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";

/**
 * サーバ側の最終防衛（修正3／案F）。
 *
 * 画面を経由しない保存（施工依頼パネルの直接 PUT）でも効くことを見たいので、
 * 純粋関数だけでなく payload 組み立ての入口 formPayloadFromValues まで通す。
 */

const h = vi.hoisted(() => ({
  /** 名簿から引ける勤務場所・所属会社。null で「引けない」を作る */
  workplace: "本社" as string | null,
  company: "トゥルーアーチ" as string | null,
}));

vi.mock("@/lib/staff-workplace-lookup", () => ({
  resolveStaffAssignmentLookupConfig: async () => ({ staffAppId: "1" }),
  // 所属支店と所属会社は1回の照会でまとめて返る
  lookupStaffAssignmentByStaffName: async (name: string | undefined) =>
    (name ?? "").trim()
      ? { workplace: h.workplace, company: h.company }
      : { workplace: null, company: null },
}));

vi.mock("@/lib/product-catalog-models", () => ({
  lookupBatteryModelNumberByCapacity: async () => null,
}));

const { formPayloadFromValues } = await import(
  "@/lib/customer-info-form/put-payload"
);

/** fieldId にキー名をそのまま使い、payload を読みやすくする */
const RESOLVED: CustomerInfoFormFieldResolved[] = CUSTOMER_INFO_FORM_FIELDS.map(
  (f) => ({
    ...f,
    fieldId: f.liffOnly ? "" : f.key,
    label: f.formLabel ?? f.caption,
    value: "",
  }),
);

const APP_FIELDS = CUSTOMER_INFO_FORM_FIELDS.filter((f) => !f.liffOnly).map(
  (f) => ({ uniqueId: f.key, caption: f.caption }),
);

const BASE_VALUES: CustomerInfoFormValues = {
  customerName: "山田太郎",
  apStaff: "冨田菜摘",
  clStaff: "鈴木一郎",
};

function buildPayload(
  values: CustomerInfoFormValues,
  loadedStaff: { apStaff?: string; clStaff?: string } | null,
) {
  return formPayloadFromValues(
    values,
    RESOLVED,
    APP_FIELDS,
    { apiKey: "dummy" },
    loadedStaff,
  );
}

beforeEach(() => {
  delete process.env.CUSTOMER_INFO_FIELD_AP_STAFF;
  delete process.env.CUSTOMER_INFO_FIELD_CL_STAFF;
  h.workplace = "本社";
  h.company = "トゥルーアーチ";
});

describe("decideApClStaffPut（判定の純粋関数）", () => {
  it("@pocket の現在値と同じなら送らない", () => {
    const d = decideApClStaffPut({ loaded: "冨田菜摘", outgoing: "冨田菜摘" });
    expect(d).toEqual({ send: false, reason: "unchanged" });
  });

  it("全角半角・空白のゆれだけなら「変わっていない」として送らない", () => {
    const d = decideApClStaffPut({ loaded: "山田 太郎", outgoing: "山田　太郎" });
    expect(d).toEqual({ send: false, reason: "unchanged" });
  });

  it("担当者を変えたときは送る", () => {
    const d = decideApClStaffPut({ loaded: "冨田菜摘", outgoing: "鈴木一郎" });
    expect(d).toEqual({ send: true, reason: "changed" });
  });

  it("★ 空欄は送らない（意図的な空欄化の運用は無いという前提）", () => {
    expect(decideApClStaffPut({ loaded: "冨田菜摘", outgoing: "" })).toEqual({
      send: false,
      reason: "empty",
    });
    expect(
      decideApClStaffPut({ loaded: "冨田菜摘", outgoing: undefined }),
    ).toEqual({ send: false, reason: "empty" });
    // "-" は normApClStaffName では空にならないので送る側に回る（列を潰さない）
    expect(decideApClStaffPut({ loaded: "冨田菜摘", outgoing: "-" }).send).toBe(
      true,
    );
  });

  it("現在値を読めなかったときは送る（@pocket 不調で変更不能にしない）", () => {
    const d = decideApClStaffPut({ loaded: null, outgoing: "鈴木一郎" });
    expect(d).toEqual({ send: true, reason: "unknown-current" });
  });

  it("現在値が読めず、送る値も空なら送らない", () => {
    expect(decideApClStaffPut({ loaded: null, outgoing: "" })).toEqual({
      send: false,
      reason: "empty",
    });
  });

  it("列が解決できず現在値が空扱いでも、同じ空同士なら送らない", () => {
    expect(decideApClStaffPut({ loaded: "", outgoing: "" })).toEqual({
      send: false,
      reason: "empty",
    });
  });
});

describe("修正3: formPayloadFromValues が変更の無い AP/CL担当者を落とす", () => {
  it("★ @pocket の現在値と同じ AP/CL担当者は payload から落ちる", async () => {
    const payload = await buildPayload(BASE_VALUES, {
      apStaff: "冨田菜摘",
      clStaff: "鈴木一郎",
    });
    expect(payload).not.toHaveProperty("apStaff");
    expect(payload).not.toHaveProperty("clStaff");
    // 巻き添えで他の列まで落ちていないこと
    // （お客様名は苗字/名前に分解して結合し直されるので全角スペースが入る）
    expect(payload).toHaveProperty("customerName");
    expect(String(payload.customerName)).toContain("山田");
  });

  it("★ AP/CL担当者を変更した場合は正しく送られる", async () => {
    const payload = await buildPayload(
      { ...BASE_VALUES, apStaff: "山田花子" },
      { apStaff: "冨田菜摘", clStaff: "鈴木一郎" },
    );
    expect(payload.apStaff).toBe("山田花子");
    // 変えていない CL は落ちる
    expect(payload).not.toHaveProperty("clStaff");
  });

  it("★ 画面の値が空でも @pocket の担当者を潰さない（施工依頼パネル経由の保護）", async () => {
    const payload = await buildPayload(
      { ...BASE_VALUES, apStaff: "", clStaff: "" },
      { apStaff: "冨田菜摘", clStaff: "鈴木一郎" },
    );
    expect(payload).not.toHaveProperty("apStaff");
    expect(payload).not.toHaveProperty("clStaff");
  });

  it("現在値を読めなかった（null）ときは従来どおり送る", async () => {
    const payload = await buildPayload(BASE_VALUES, null);
    expect(payload.apStaff).toBe("冨田菜摘");
    expect(payload.clStaff).toBe("鈴木一郎");
  });

  it("新規入力（@pocket 側が空）なら送る", async () => {
    const payload = await buildPayload(BASE_VALUES, {
      apStaff: "",
      clStaff: "",
    });
    expect(payload.apStaff).toBe("冨田菜摘");
    expect(payload.clStaff).toBe("鈴木一郎");
  });
});

describe("所属支店の保護（8/11 の修正）と矛盾しないこと", () => {
  it("担当者が変わっていなければ支店も送らない", async () => {
    const payload = await buildPayload(BASE_VALUES, {
      apStaff: "冨田菜摘",
      clStaff: "鈴木一郎",
    });
    expect(payload).not.toHaveProperty("apBranch");
    expect(payload).not.toHaveProperty("clBranch");
  });

  it("担当者を変えたら担当者と支店の両方が送られる", async () => {
    const payload = await buildPayload(
      { ...BASE_VALUES, apStaff: "山田花子" },
      { apStaff: "冨田菜摘", clStaff: "鈴木一郎" },
    );
    expect(payload.apStaff).toBe("山田花子");
    expect(payload.apBranch).toBe("本社");
  });

  it("担当者を空にしたときは担当者も支店も送らない（片方だけ残さない）", async () => {
    const payload = await buildPayload(
      { ...BASE_VALUES, apStaff: "" },
      { apStaff: "冨田菜摘", clStaff: "鈴木一郎" },
    );
    expect(payload).not.toHaveProperty("apStaff");
    expect(payload).not.toHaveProperty("apBranch");
  });
});

/**
 * 所属会社は所属支店とまったく同じ仕組み。担当者が変わったかの判定も
 * 名簿の照会も**共通の1回**で、引けたほうだけ書く。
 */
describe("所属会社（所属支店と同じ仕組み）", () => {
  it("★ 担当者が変わらなければ支店も会社も送らない", async () => {
    const payload = await buildPayload(BASE_VALUES, {
      apStaff: "冨田菜摘",
      clStaff: "鈴木一郎",
    });
    for (const key of ["apBranch", "clBranch", "apCompany", "clCompany"]) {
      expect(payload, key).not.toHaveProperty(key);
    }
  });

  it("★ 担当者を変えたら支店と会社の両方が送られる", async () => {
    const payload = await buildPayload(
      { ...BASE_VALUES, apStaff: "山田花子" },
      { apStaff: "冨田菜摘", clStaff: "鈴木一郎" },
    );
    expect(payload.apStaff).toBe("山田花子");
    expect(payload.apBranch).toBe("本社");
    expect(payload.apCompany).toBe("トゥルーアーチ");
    // 変わっていない CL 側は引き直さない
    expect(payload).not.toHaveProperty("clBranch");
    expect(payload).not.toHaveProperty("clCompany");
  });

  it("★ 会社が引けなければ会社だけ書かない（支店は書く）", async () => {
    h.company = null;

    const payload = await buildPayload(
      { ...BASE_VALUES, apStaff: "山田花子" },
      { apStaff: "冨田菜摘", clStaff: "鈴木一郎" },
    );
    expect(payload.apBranch).toBe("本社");
    expect(payload).not.toHaveProperty("apCompany");
  });

  it("★ 支店が引けなければ支店だけ書かない（会社は書く）", async () => {
    h.workplace = null;

    const payload = await buildPayload(
      { ...BASE_VALUES, apStaff: "山田花子" },
      { apStaff: "冨田菜摘", clStaff: "鈴木一郎" },
    );
    expect(payload.apCompany).toBe("トゥルーアーチ");
    expect(payload).not.toHaveProperty("apBranch");
  });

  it("★ どちらも引けなければ \"-\" で潰さない", async () => {
    h.workplace = null;
    h.company = null;

    const payload = await buildPayload(
      { ...BASE_VALUES, apStaff: "山田花子" },
      { apStaff: "冨田菜摘", clStaff: "鈴木一郎" },
    );
    for (const key of ["apBranch", "apCompany"]) {
      expect(payload, key).not.toHaveProperty(key);
    }
  });

  it("★ 担当者を空にしたときは会社も送らない", async () => {
    const payload = await buildPayload(
      { ...BASE_VALUES, apStaff: "" },
      { apStaff: "冨田菜摘", clStaff: "鈴木一郎" },
    );
    expect(payload).not.toHaveProperty("apStaff");
    expect(payload).not.toHaveProperty("apBranch");
    expect(payload).not.toHaveProperty("apCompany");
  });
});

/**
 * 引けなかったことをログに残す。
 *
 * 「引けなければ黙って書かない」は値を潰さないための正しい動きだが、
 * 正常系と区別が付かず、設定漏れの切り分けに時間がかかった。
 * 残すのは**取れなかった事実だけ**で、氏名や値は出さない。
 */
describe("所属を引けなかったときのログ", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  function warned(): string {
    return warnSpy.mock.calls
      .map((c) => c.map((x) => String(x)).join(" "))
      .join(" | ");
  }

  it("★ 会社が引けなければ、どのロールの何が取れなかったかを残す", async () => {
    h.company = null;

    await buildPayload(
      { ...BASE_VALUES, apStaff: "山田花子" },
      { apStaff: "冨田菜摘", clStaff: "鈴木一郎" },
    );

    const logged = warned();
    expect(logged).toContain("担当者の所属を名簿から引けませんでした");
    expect(logged).toContain('"role":"AP"');
    expect(logged).toContain('"company"');
    expect(logged).not.toContain('"branch"');
  });

  it("★ 支店が引けなければ支店を残す", async () => {
    h.workplace = null;

    await buildPayload(
      { ...BASE_VALUES, clStaff: "山田花子" },
      { apStaff: "冨田菜摘", clStaff: "鈴木一郎" },
    );

    const logged = warned();
    expect(logged).toContain('"role":"CL"');
    expect(logged).toContain('"branch"');
  });

  it("★ 氏名・引けた値をログに含めない", async () => {
    h.company = null;

    await buildPayload(
      { ...BASE_VALUES, apStaff: "山田花子" },
      { apStaff: "冨田菜摘", clStaff: "鈴木一郎" },
    );

    const logged = warned();
    for (const secret of ["山田花子", "冨田菜摘", "鈴木一郎", "本社"]) {
      expect(logged, secret).not.toContain(secret);
    }
  });

  it("★ 両方引けたときは出さない", async () => {
    await buildPayload(
      { ...BASE_VALUES, apStaff: "山田花子" },
      { apStaff: "冨田菜摘", clStaff: "鈴木一郎" },
    );

    expect(warned()).not.toContain("担当者の所属を名簿から引けませんでした");
  });

  it("★ 担当者を変えていないときは出さない（毎回流さない）", async () => {
    h.workplace = null;
    h.company = null;

    await buildPayload(BASE_VALUES, {
      apStaff: "冨田菜摘",
      clStaff: "鈴木一郎",
    });

    expect(warned()).not.toContain("担当者の所属を名簿から引けませんでした");
  });
});
