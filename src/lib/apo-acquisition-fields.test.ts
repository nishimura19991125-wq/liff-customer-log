import { describe, expect, it } from "vitest";

import {
  APO_ACQUISITION_FIELD_SPECS,
  resolveApoAcquisitionFields,
} from "@/lib/apo-acquisition-fields";
import { APO_ACQUISITION_FIELD_KEYS } from "@/lib/apo-acquisition-types";

/**
 * 入力項目の定義。必須と選択肢はここが唯一の情報源で、
 * サーバの必須チェックも画面の「*」表示も同じ値を見ている
 * （クライアント側に別の必須判定は無い）。
 */

describe("必須項目", () => {
  it("★ 必須は7項目", () => {
    const required = APO_ACQUISITION_FIELD_KEYS.filter(
      (k) => APO_ACQUISITION_FIELD_SPECS[k].required,
    ).map((k) => APO_ACQUISITION_FIELD_SPECS[k].label);

    expect(required.sort()).toEqual(
      [
        "AP担当者",
        "アポ取得日",
        "アポ種別",
        "見積種別",
        "お客様名",
        "ギフト券",
        "アポランク",
      ].sort(),
    );
  });

  it("★ CL担当者・商談・資料送付予定日時は任意", () => {
    expect(APO_ACQUISITION_FIELD_SPECS.clStaff.required).toBe(false);
    expect(APO_ACQUISITION_FIELD_SPECS.scheduledDate.required).toBe(false);
  });

  it("★ ギフト券・アポランクは必須", () => {
    expect(APO_ACQUISITION_FIELD_SPECS.giftCoupon.required).toBe(true);
    expect(APO_ACQUISITION_FIELD_SPECS.apoRank.required).toBe(true);
  });

  it("その他メーカーは spec としては任意（「その他」選択時のみサーバで必須にする）", () => {
    expect(APO_ACQUISITION_FIELD_SPECS.otherManufacturer.required).toBe(false);
  });
});

describe("アポランクの選択肢", () => {
  it("★ A / B の2つだけ", () => {
    expect(APO_ACQUISITION_FIELD_SPECS.apoRank.options).toEqual(["A", "B"]);
  });

  it("固定指定が残っている（fixedOptions）", () => {
    /*
     * 選択肢の自動取得をやめたので、現在この指定は効果を持たない
     * （options が常に使われる）。自動取得を復活させたときに
     * C / D を画面へ出さないための記録として残している
     */
    expect(APO_ACQUISITION_FIELD_SPECS.apoRank.fixedOptions).toBe(true);
  });

  it("C / D は含まない", () => {
    expect(APO_ACQUISITION_FIELD_SPECS.apoRank.options).not.toContain("C");
    expect(APO_ACQUISITION_FIELD_SPECS.apoRank.options).not.toContain("D");
  });
});

describe("入力項目の増減", () => {
  it("★ 見積依頼内容は入力項目に無い", () => {
    expect(APO_ACQUISITION_FIELD_KEYS).not.toContain("estimateRequest");
  });

  it("★ 希望メーカー・その他メーカーが入力項目にある", () => {
    expect(APO_ACQUISITION_FIELD_KEYS).toContain("desiredManufacturer");
    expect(APO_ACQUISITION_FIELD_KEYS).toContain("otherManufacturer");
  });

  it("希望メーカーはテキスト型の列へカンマ区切りで書く", () => {
    const spec = APO_ACQUISITION_FIELD_SPECS.desiredManufacturer;
    expect(spec.kind).toBe("checkboxGroupText");
    expect(spec.options).toEqual(["SHARP", "XSOL", "Panasonic", "その他"]);
    expect(spec.fixedOptions).toBe(true);
  });

  it("★ 見出しが分からない2項目は識別名で引く", () => {
    expect(APO_ACQUISITION_FIELD_SPECS.desiredManufacturer.fallbackFieldId).toBe(
      "field-61",
    );
    expect(APO_ACQUISITION_FIELD_SPECS.otherManufacturer.fallbackFieldId).toBe(
      "field-60",
    );
    // 推測の見出し候補は書かない
    expect(APO_ACQUISITION_FIELD_SPECS.desiredManufacturer.captions).toEqual([]);
    expect(APO_ACQUISITION_FIELD_SPECS.otherManufacturer.captions).toEqual([]);
  });

  it("定義と表示順のキーが一致している", () => {
    expect(Object.keys(APO_ACQUISITION_FIELD_SPECS).sort()).toEqual(
      [...APO_ACQUISITION_FIELD_KEYS].sort(),
    );
  });
});

describe("★ オール電化orガスの選択肢", () => {
  const spec = APO_ACQUISITION_FIELD_SPECS.electricOrGas;

  /*
   * @pocket の実物は「オール電化 / ガス住宅」。
   * コード側が「ガス」だったため、それを選んだ登録が 400 で弾かれていた
   *   オール電化 or ガス 「ガス」 は登録されていません
   * 選択肢は @pocket と手動で合わせるしかない（自動取得の経路は無い）
   */
  it("実物どおり オール電化 / ガス住宅", () => {
    expect(spec.options).toEqual(["オール電化", "ガス住宅"]);
  });

  it("「ガス」単体は含まない（@pocket に無い値）", () => {
    expect(spec.options).not.toContain("ガス");
  });

  it("★ 実際の列名「オール電化 or ガス」を完全一致で引ける", () => {
    // 以前は部分一致で「オール電化」に引っかかっていただけだった
    expect(spec.captions[0]).toBe("オール電化 or ガス");
  });

  it("既存の見出し候補は残す（解決先を変えない）", () => {
    for (const c of ["オール電化orガス", "オール電化", "電化ガス", "電気ガス"]) {
      expect(spec.captions).toContain(c);
    }
  });
});

describe("選択肢はハードコードで @pocket と手動同期する", () => {
  /*
   * 以前は extractPocketOptions が @pocket の列定義から選択肢を読む建前
   * だったが、一度も機能していなかった（atpocket.ts の
   * normalizeAtPocketFieldRow が6つのキーだけを残して組み立て直すため、
   * 選択肢はここへ届く前に捨てられる）。
   * 実物と突き合わせ済みなのは オール電化orガス だけ。
   * 残りは未確認で、食い違っていればその値を選んだときに 400 になる
   */
  const UNVERIFIED = [
    "giftCoupon",
    "apoType",
    "estimateType",
    "subsidy",
    "roofShape",
    "roofMaterial",
    "existingEquipment",
  ] as const;

  it("未確認の項目にも選択肢が入っている（空にしない）", () => {
    for (const key of UNVERIFIED) {
      expect(APO_ACQUISITION_FIELD_SPECS[key].options?.length ?? 0)
        .toBeGreaterThan(0);
    }
  });

  it("★ 今回の修正で他項目の選択肢は変えていない", () => {
    expect(APO_ACQUISITION_FIELD_SPECS.giftCoupon.options).toEqual(["有", "無"]);
    expect(APO_ACQUISITION_FIELD_SPECS.subsidy.options).toEqual([
      "有",
      "無",
      "不明",
    ]);
    expect(APO_ACQUISITION_FIELD_SPECS.roofShape.options).toEqual([
      "片流れ",
      "切妻",
      "寄棟",
      "陸屋根",
    ]);
    expect(APO_ACQUISITION_FIELD_SPECS.apoType.options).toEqual([
      "ダイレクト",
      "お客様紹介",
      "(DC)工務店OBリスト",
      "ソーラーパートナーズ",
    ]);
    expect(APO_ACQUISITION_FIELD_SPECS.estimateType.options).toEqual([
      "太陽光パネル＋蓄電池",
      "蓄電池単体",
      "太陽光単体",
      "その他",
    ]);
    expect(APO_ACQUISITION_FIELD_SPECS.existingEquipment.options).toEqual([
      "ガス給湯器",
      "エコキュート",
      "IH",
      "エネファーム",
      "エコウィル",
    ]);
    expect(APO_ACQUISITION_FIELD_SPECS.roofMaterial.options).toHaveLength(10);
  });
});

describe("★ オール電化orガスの列の解決", () => {
  const field = (uniqueId: string, caption: string) => ({
    uniqueId,
    caption,
    fieldType: "SingleSelect",
  });
  /** 必須列が無いと他の解決に影響するので最低限そろえる */
  const base = [
    field("field-9", "お客様名"),
    field("field-8", "商談・資料送付予定日時"),
  ];

  it("実際の列名「オール電化 or ガス」を引ける", () => {
    const resolved = resolveApoAcquisitionFields([
      ...base,
      field("field-20", "オール電化 or ガス"),
    ]);

    expect(resolved.electricOrGas.uniqueId).toBe("field-20");
  });

  it("見出し候補の追加で解決先が変わらない（旧表記も従来どおり）", () => {
    for (const caption of ["オール電化orガス", "オール電化", "電化ガス"]) {
      const resolved = resolveApoAcquisitionFields([
        ...base,
        field("field-20", caption),
      ]);
      expect(resolved.electricOrGas.uniqueId).toBe("field-20");
    }
  });

  it("該当する列が無ければ null（別の列を掴まない）", () => {
    const resolved = resolveApoAcquisitionFields([
      ...base,
      field("field-21", "屋根形状"),
    ]);

    expect(resolved.electricOrGas.uniqueId).toBeNull();
  });
});
