import { afterEach, describe, expect, it, vi } from "vitest";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { EQUIPMENT_WARRANTY_PERIOD_OPTIONS } from "@/lib/customer-info-form/options";
import { resolveCustomerInfoFormFields } from "@/lib/customer-info-form/resolve-fields";
import {
  applyCustomerInfoHiddenDefaultsToValues,
  buildCustomerInfoFormPayload,
  isCustomerInfoFormFieldVisible,
} from "@/lib/customer-info-form/rules";
import {
  CUSTOMER_INFO_FORM_FIELD_MAP,
  CUSTOMER_INFO_FORM_FIELDS,
  INSTALLATION_TYPE_OPTIONS,
} from "@/lib/customer-info-form/schema";
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";
import {
  findMissingRequiredCustomerInfoFields,
  isCustomerInfoFieldRequired,
  isCustomerInfoVisibleFieldValueMissing,
} from "@/lib/customer-info-form/validate";

/**
 * 機器保証期間（契約情報入力・単一選択・必須・表示条件なし）。
 *
 * 専用の判定は1つも足していない。表示・必須・保存はすべて既存の
 * isCustomerInfoFormFieldVisible を通り、列は resolveCustomerInfoFormFieldId が
 * 解決する。ここではその「既存の仕組みに乗っていること」を固定する。
 */

const KEY = "equipmentWarrantyPeriod";
const CAPTION = "機器保証期間";
const ENV = "CUSTOMER_INFO_FIELD_EQUIPMENT_WARRANTY_PERIOD";

/** 解決済みフィールドは**スキーマからだけ**組み立てる（手で足さない） */
function resolveAll(): CustomerInfoFormFieldResolved[] {
  return CUSTOMER_INFO_FORM_FIELDS.map((f) => ({
    ...f,
    fieldId: f.liffOnly ? "" : f.key,
    label: f.caption,
    value: "",
  }));
}

const RESOLVED = resolveAll();

function payloadFor(values: CustomerInfoFormValues): Record<string, unknown> {
  return buildCustomerInfoFormPayload(values, RESOLVED);
}

function validateField() {
  const def = CUSTOMER_INFO_FORM_FIELD_MAP.get(KEY);
  if (!def) throw new Error(`schema に無いキー: ${KEY}`);
  return {
    key: def.key,
    label: def.caption,
    type: def.type,
    required: def.required,
  };
}

describe("機器保証期間: 列定義（スキーマ）", () => {
  const def = CUSTOMER_INFO_FORM_FIELD_MAP.get(KEY);

  it("★ フォームに含まれる", () => {
    expect(def).toBeDefined();
    expect(def?.caption).toBe(CAPTION);
  });

  it("★ メーカーの直後にある", () => {
    const keys = CUSTOMER_INFO_FORM_FIELDS.map((f) => f.key);
    const i = keys.indexOf("manufacturer");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(keys[i + 1]).toBe(KEY);
  });

  it("単一選択（メーカーと同じ select）", () => {
    expect(def?.type).toBe("select");
    expect(def?.type).toBe(CUSTOMER_INFO_FORM_FIELD_MAP.get("manufacturer")?.type);
  });

  it("★ 選択肢は 10年 / 15年 / 20年 の3つ（定義は options.ts の1箇所）", () => {
    expect([...EQUIPMENT_WARRANTY_PERIOD_OPTIONS]).toEqual([
      "10年",
      "15年",
      "20年",
    ]);
    expect(def?.options && [...def.options]).toEqual([
      ...EQUIPMENT_WARRANTY_PERIOD_OPTIONS,
    ]);
  });

  it("選択肢は固定（一覧連携待ちではない）", () => {
    expect(def?.optionsPending).toBeFalsy();
  });

  it("@pocket へ保存する項目（画面だけ・サーバ転記だけの項目ではない）", () => {
    expect(def?.liffOnly).toBeFalsy();
    expect(def?.hiddenInForm).toBeFalsy();
  });

  it("必須（required を false にしていない）", () => {
    expect(def?.required).toBeUndefined();
  });

  it("初期値を持たない（hiddenValue も付けない）", () => {
    expect(def).not.toHaveProperty("hiddenValue");
  });
});

describe("機器保証期間: 表示条件が無い", () => {
  it.each([...INSTALLATION_TYPE_OPTIONS, ""])(
    "★ 設置種別「%s」で表示される",
    (installationType) => {
      expect(isCustomerInfoFormFieldVisible(KEY, { installationType })).toBe(
        true,
      );
    },
  );

  it("他の入力が何であっても表示される", () => {
    for (const values of [
      {},
      { fitType: "非FIT" },
      { paymentMethod: "現金一括" },
      { introduction: "ダイレクト" },
      { indoorSurveyStatus: "未実施" },
      { manufacturer: "" },
    ] as CustomerInfoFormValues[]) {
      expect(
        isCustomerInfoFormFieldVisible(KEY, values),
        JSON.stringify(values),
      ).toBe(true);
    }
  });

  it("非表示の項目を既定値で揃える処理でも触られない", () => {
    for (const installationType of INSTALLATION_TYPE_OPTIONS) {
      const next = applyCustomerInfoHiddenDefaultsToValues({
        installationType,
        [KEY]: "15年",
      });
      expect(next[KEY], installationType).toBe("15年");
    }
  });
});

describe("機器保証期間: 必須", () => {
  it("★ 未入力だと必須エラーになる", () => {
    for (const raw of ["", "  ", "-"]) {
      expect(
        isCustomerInfoVisibleFieldValueMissing(validateField(), { [KEY]: raw }),
        `値「${raw}」`,
      ).toBe(true);
    }
  });

  it.each([...INSTALLATION_TYPE_OPTIONS])(
    "★ 設置種別「%s」でも未入力なら必須エラー",
    (installationType) => {
      const missing = findMissingRequiredCustomerInfoFields(
        [validateField()],
        { installationType, [KEY]: "" },
      );
      expect(missing.map((f) => f.key)).toEqual([KEY]);
    },
  );

  it.each([...EQUIPMENT_WARRANTY_PERIOD_OPTIONS])(
    "「%s」を選べばエラーにならない",
    (value) => {
      expect(
        isCustomerInfoVisibleFieldValueMissing(validateField(), {
          [KEY]: value,
        }),
      ).toBe(false);
    },
  );

  it("キャンセルのときは他の項目と同じく必須から外れる", () => {
    expect(
      isCustomerInfoFieldRequired(validateField(), {
        customerStatus: "キャンセル",
      }),
    ).toBe(false);
  });

  it("室内現調「未実施」では緩和されない（対象は分電盤・化粧カバーだけ）", () => {
    expect(
      isCustomerInfoFieldRequired(validateField(), {
        indoorSurveyStatus: "未実施",
      }),
    ).toBe(true);
  });
});

describe("機器保証期間: 保存（既存の payload 組み立てを通る）", () => {
  it.each([...EQUIPMENT_WARRANTY_PERIOD_OPTIONS])(
    "★ 選んだ「%s」がそのまま payload に載る",
    (value) => {
      expect(payloadFor({ [KEY]: value })[KEY]).toBe(value);
    },
  );

  it.each([...INSTALLATION_TYPE_OPTIONS])(
    "★ 設置種別「%s」でも payload に載る",
    (installationType) => {
      expect(payloadFor({ installationType, [KEY]: "20年" })[KEY]).toBe("20年");
    },
  );

  it('未選択なら空文字（"-" で潰さない）', () => {
    expect(payloadFor({ [KEY]: "" })[KEY]).toBe("");
  });
});

/**
 * 列の解決。専用の経路は無く、他の項目と同じ resolveCustomerInfoFormFieldId を
 * 通る。比較対象の「既存項目」には、同じく条件なしの select である
 * FIT or 非FIT（fitType）を使う。
 */
describe("機器保証期間: 列の解決（環境変数）", () => {
  const FIT_ENV = "CUSTOMER_INFO_FIELD_FIT_TYPE";
  const FIT_CAPTION = "FIT or 非FIT";

  function appFields(
    rows: { uniqueId: string; caption: string }[],
  ): AtPocketFieldRow[] {
    return rows.map((r) => ({ ...r, fieldType: "Select" }) as AtPocketFieldRow);
  }

  function resolveKey(fields: AtPocketFieldRow[], key: string) {
    const { resolved, missingCaptions } = resolveCustomerInfoFormFields(fields);
    return {
      resolved,
      missingCaptions,
      field: resolved.find((f) => f.key === key),
    };
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("★ 環境変数で指定した列に解決される", () => {
    vi.stubEnv(ENV, "field-311");
    // 見出しは一致させない（環境変数だけで引けることを見る）
    const { field } = resolveKey(
      appFields([{ uniqueId: "field-311", caption: "別の見出し" }]),
      KEY,
    );
    expect(field?.fieldId).toBe("field-311");
  });

  it("★ 未設定なら見出し「機器保証期間」の完全一致で解決される（既存項目と同じ）", () => {
    vi.stubEnv(ENV, "");
    vi.stubEnv(FIT_ENV, "");
    const fields = appFields([
      { uniqueId: "field-311", caption: CAPTION },
      { uniqueId: "field-200", caption: FIT_CAPTION },
    ]);
    expect(resolveKey(fields, KEY).field?.fieldId).toBe("field-311");
    expect(resolveKey(fields, "fitType").field?.fieldId).toBe("field-200");
  });

  it("★ 未設定かつ見出しも無ければ解決されない（既存項目と同じ）", () => {
    vi.stubEnv(ENV, "");
    vi.stubEnv(FIT_ENV, "");
    const fields = appFields([{ uniqueId: "field-1", caption: "メーカー" }]);

    const own = resolveKey(fields, KEY);
    expect(own.field).toBeUndefined();
    expect(own.missingCaptions).toContain(CAPTION);

    const existing = resolveKey(fields, "fitType");
    expect(existing.field).toBeUndefined();
    expect(existing.missingCaptions).toContain(FIT_CAPTION);
  });

  it("★ 解決されないときは、画面に出ず・必須にならず・保存もしない", () => {
    vi.stubEnv(ENV, "");
    const { resolved } = resolveKey(
      appFields([{ uniqueId: "field-1", caption: "メーカー" }]),
      KEY,
    );
    // 画面・必須チェック・保存はいずれも resolved から組み立てる
    expect(resolved.map((f) => f.key)).not.toContain(KEY);
    const missing = findMissingRequiredCustomerInfoFields(
      resolved.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
      })),
      { [KEY]: "" },
    );
    expect(missing.map((f) => f.key)).not.toContain(KEY);
    const payload = buildCustomerInfoFormPayload({ [KEY]: "10年" }, resolved);
    expect(Object.values(payload)).not.toContain("10年");
  });

  it("列定義と一致しない値を入れたときは見出しへ落ちずに未解決（既存項目と同じ）", () => {
    vi.stubEnv(ENV, "field-99999");
    vi.stubEnv(FIT_ENV, "field-99998");
    const fields = appFields([
      { uniqueId: "field-311", caption: CAPTION },
      { uniqueId: "field-200", caption: FIT_CAPTION },
    ]);
    expect(resolveKey(fields, KEY).field).toBeUndefined();
    expect(resolveKey(fields, "fitType").field).toBeUndefined();
  });

  it("解決された列へ選んだ値が載る（環境変数 → payload まで通し）", () => {
    vi.stubEnv(ENV, "field-311");
    const { resolved } = resolveKey(
      appFields([{ uniqueId: "field-311", caption: CAPTION }]),
      KEY,
    );
    const payload = buildCustomerInfoFormPayload({ [KEY]: "15年" }, resolved);
    expect(payload["field-311"]).toBe("15年");
  });
});
