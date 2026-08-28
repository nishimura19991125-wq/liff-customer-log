import { describe, expect, it } from "vitest";

import {
  buildConstructionEmptySlotResetPatch,
  isConstructionSlotResetField,
  CONSTRUCTION_SLOT_KEEP_FIELDS,
  CONSTRUCTION_SLOT_KEEP_FIELD_LABELS,
  buildConstructionSlotKeepFieldIds,
  CONSTRUCTION_SLOT_RESET_FIELDS,
  CONSTRUCTION_SLOT_RESET_FIELD_LABELS,
  type ConstructionSlotResetField,
  type ConstructionSlotResetFieldIds,
} from "@/lib/calendar-empty-slot-reset";
import { CUSTOMER_INFO_CONSTRUCTION_LOCKED_FIELDS } from "@/lib/customer-info-construction-locked-fields";
import type { ConstructionClearedField } from "@/lib/customer-cancel-server";

/**
 * 工事日変更 M-1: 移動元のレコードを空き枠に戻す patch。
 *
 * ここで固定するのは次の4つ。
 *   - 消すのは お客様名 / T番号 / 住宅ステータス / 工事対応者 の4つだけ
 *   - 施工予定日・施工会社・Aki番号 は patch に入らない（残す）
 *   - 定義の配列に足せば追随する
 *   - **キャンセル処理と消す列を取り違えていない**
 */

const NAME = "field-2";
const T_NUMBER = "field-1";
const HOUSING = "field-5";
const HANDLER = "field-6";

const START_DATE = "field-3";
const CONTRACTOR = "field-4";
const AKI = "field-101";

const KEEP = [START_DATE, CONTRACTOR, AKI];

const FIELD_IDS: Record<ConstructionSlotResetField, string> = {
  customerName: NAME,
  tNumber: T_NUMBER,
  housingStatus: HOUSING,
  constructionHandler: HANDLER,
};

function build(
  over: Partial<Record<ConstructionSlotResetField, ConstructionSlotResetFieldIds>> = {},
  keepFieldIds: readonly (string | null | undefined)[] = KEEP,
) {
  return buildConstructionEmptySlotResetPatch({
    fieldIdsOf: (key) => (key in over ? over[key] : FIELD_IDS[key]),
    keepFieldIds,
  });
}

describe("消す列", () => {
  it("★ 4項目が空文字で patch に入る", () => {
    const { patch, cleared } = build();

    expect(patch).toEqual({
      [NAME]: "",
      [T_NUMBER]: "",
      [HOUSING]: "",
      [HANDLER]: "",
    });
    expect(cleared).toEqual([
      "customerName",
      "tNumber",
      "housingStatus",
      "constructionHandler",
    ]);
  });

  it("★ 施工予定日・施工会社は patch に入らない（残す）", () => {
    const { patch } = build();

    expect(patch).not.toHaveProperty(START_DATE);
    expect(patch).not.toHaveProperty(CONTRACTOR);
  });

  it("★ Aki番号 は patch に入らない（値を知らないまま触らない）", () => {
    const { patch } = build();

    // 取込キーの補完は writePocketRecordWithImportKey に任せる。
    // ここで空文字などを入れると採番済みの Aki番号 を壊す
    expect(patch).not.toHaveProperty(AKI);
    expect(Object.values(patch)).not.toContain(undefined);
  });

  it("空にするのは必ず空文字（null や undefined を送らない）", () => {
    const { patch } = build();

    for (const value of Object.values(patch)) {
      expect(value).toBe("");
    }
  });
});

describe("列が解決できないとき", () => {
  it("★ 解決できない項目があっても壊れず、残りは空にする", () => {
    const { patch, cleared, unresolved } = build({
      housingStatus: null,
      constructionHandler: "",
    });

    expect(patch).toEqual({ [NAME]: "", [T_NUMBER]: "" });
    expect(cleared).toEqual(["customerName", "tNumber"]);
    expect(unresolved).toEqual(["housingStatus", "constructionHandler"]);
  });

  it("全部解決できなければ patch は空。呼び出し側が書き込みを止められる", () => {
    const { patch, cleared, unresolved } = build({
      customerName: null,
      tNumber: null,
      housingStatus: null,
      constructionHandler: null,
    });

    expect(patch).toEqual({});
    expect(cleared).toEqual([]);
    expect(unresolved).toHaveLength(CONSTRUCTION_SLOT_RESET_FIELDS.length);
  });
});

describe("お客様名の列が2つあるとき", () => {
  /**
   * 工事アプリのお客様名は解決経路が2つある（見出し / 環境変数）。
   * 食い違うと片方だけ空になり、空き枠に戻らない
   */
  it("★ 解決できた列を全部空にする", () => {
    const { patch, cleared } = build({
      customerName: [NAME, "field-99"],
    });

    expect(patch[NAME]).toBe("");
    expect(patch["field-99"]).toBe("");
    expect(cleared).toContain("customerName");
  });

  it("同じ列を2回渡しても1つにまとまる", () => {
    const { patch } = build({ customerName: [NAME, NAME, " " + NAME + " "] });

    expect(Object.keys(patch).filter((k) => k === NAME)).toHaveLength(1);
    expect(patch[NAME]).toBe("");
  });

  it("空文字や null が混ざっていても無視する", () => {
    const { patch, cleared } = build({
      customerName: [null, "", NAME, undefined],
    });

    expect(patch[NAME]).toBe("");
    expect(cleared).toContain("customerName");
  });
});

describe("★ 残す列を消してしまわない", () => {
  it("★ 消す側の解決が施工会社を指しても patch へ入れない", () => {
    // 見出しの表記ゆれや環境変数の設定ミスで起こりうる
    const { patch, keptFieldIds, unresolved } = build({
      housingStatus: CONTRACTOR,
    });

    expect(patch).not.toHaveProperty(CONTRACTOR);
    expect(keptFieldIds).toEqual([CONTRACTOR]);
    // 空にできなかったので未解決として報告する
    expect(unresolved).toContain("housingStatus");
  });

  it("★ 消す側の解決が Aki番号 を指しても patch へ入れない", () => {
    const { patch, keptFieldIds } = build({ tNumber: AKI });

    expect(patch).not.toHaveProperty(AKI);
    expect(keptFieldIds).toEqual([AKI]);
  });

  it("複数列のうち残す列だけを外し、残りは空にする", () => {
    const { patch, cleared, keptFieldIds } = build({
      customerName: [NAME, START_DATE],
    });

    expect(patch[NAME]).toBe("");
    expect(patch).not.toHaveProperty(START_DATE);
    expect(cleared).toContain("customerName");
    expect(keptFieldIds).toEqual([START_DATE]);
  });

  it("keepFieldIds を渡さなくても動く（守りは効かなくなる）", () => {
    const { patch } = build({}, []);

    expect(patch[NAME]).toBe("");
    expect(Object.keys(patch)).toHaveLength(4);
  });
});

describe("定義", () => {
  it("★ 定義の配列に足せば patch が追随する", () => {
    // 「配列を回して組み立てている」ことの確認。
    // 個別に列挙していたら、この件数の一致は偶然でしか成立しない
    const { patch, cleared } = build();

    expect(cleared).toEqual([...CONSTRUCTION_SLOT_RESET_FIELDS]);
    expect(Object.keys(patch)).toHaveLength(
      CONSTRUCTION_SLOT_RESET_FIELDS.length,
    );
  });

  it("すべての項目にラベルがある", () => {
    for (const key of CONSTRUCTION_SLOT_RESET_FIELDS) {
      expect(CONSTRUCTION_SLOT_RESET_FIELD_LABELS[key]).toBeTruthy();
    }
  });

  it("isConstructionSlotResetField が定義と一致する", () => {
    for (const key of CONSTRUCTION_SLOT_RESET_FIELDS) {
      expect(isConstructionSlotResetField(key)).toBe(true);
    }
    expect(isConstructionSlotResetField("constructionDate")).toBe(false);
    expect(isConstructionSlotResetField("constructionContractor")).toBe(false);
  });

  it("残す項目のラベルに施工予定日・施工会社・Aki番号 が並ぶ", () => {
    expect([...CONSTRUCTION_SLOT_KEEP_FIELD_LABELS]).toEqual([
      "施工予定日",
      "施工会社",
      "Aki番号",
    ]);
  });
});

describe("★ キャンセル処理と取り違えていない", () => {
  /**
   * キャンセルは 施工予定日 / 施工会社 / 工事対応者 を消す。
   * 移動は お客様名 / T番号 / 住宅ステータス / 工事対応者 を消す。
   * 共通は工事対応者だけで、他は正反対。
   */
  it("★ 施工予定日・施工会社を消す対象にしていない", () => {
    const keys = [...CONSTRUCTION_SLOT_RESET_FIELDS] as string[];

    expect(keys).not.toContain("startDate");
    expect(keys).not.toContain("constructionDate");
    expect(keys).not.toContain("contractor");
    expect(keys).not.toContain("constructionContractor");
  });

  it("★ 共通するのは工事対応者だけ", () => {
    // キャンセルが消すもの（customer-cancel-server.ts の ConstructionClearedField）
    const cancelClears = ["startDate", "contractor", "constructionHandler"];
    const moveClears = [...CONSTRUCTION_SLOT_RESET_FIELDS] as string[];

    const shared = cancelClears.filter((k) => moveClears.includes(k));
    expect(shared).toEqual(["constructionHandler"]);
  });

  it("★ 共通が増えたら型で落ちる（実行時ではなくコンパイルで気づく）", () => {
    /*
     * 上のテストはキャンセル側の列名を書き写しているので、あちらが変わっても
     * 気づけない。型の交差でも固定しておく。どちらかの定義に相手と同じ
     * キーが増えると Shared が広がり、この代入がコンパイルエラーになる
     */
    type Shared = ConstructionClearedField & ConstructionSlotResetField;
    const sharedIsOnlyHandler: Shared extends "constructionHandler"
      ? true
      : false = true;

    expect(sharedIsOnlyHandler).toBe(true);
  });

  it("お客様情報側の編集不可の定義とも別物（あちらは施工予定日・施工業者）", () => {
    const locked = [...CUSTOMER_INFO_CONSTRUCTION_LOCKED_FIELDS] as string[];
    const moveClears = [...CONSTRUCTION_SLOT_RESET_FIELDS] as string[];

    expect(locked.some((k) => moveClears.includes(k))).toBe(false);
  });
});

/**
 * M-1 の積み残し。ラベルだけの配列だと、確認画面の説明と実際に残る列が
 * ずれても誰も気づかない。キーと対にし、列 ID の組み立ても同じ定義から
 * 導出するようにしたので、片方だけ増減させられない。
 */
describe("★ 残す列（ラベルと列 ID を結びつける）", () => {
  const keepIdOf = (key: (typeof CONSTRUCTION_SLOT_KEEP_FIELDS)[number]["key"]) =>
    key === "startDate"
      ? START_DATE
      : key === "contractor"
        ? CONTRACTOR
        : AKI;

  it("★ ラベルは定義から導出される（手書きの配列ではない）", () => {
    expect([...CONSTRUCTION_SLOT_KEEP_FIELD_LABELS]).toEqual(
      CONSTRUCTION_SLOT_KEEP_FIELDS.map((f) => f.label),
    );
  });

  it("★ 列 ID の数とラベルの数が一致する", () => {
    const { fieldIds, unresolved } = buildConstructionSlotKeepFieldIds(keepIdOf);

    expect(unresolved).toEqual([]);
    expect(fieldIds).toHaveLength(CONSTRUCTION_SLOT_KEEP_FIELD_LABELS.length);
    expect(fieldIds).toEqual([START_DATE, CONTRACTOR, AKI]);
  });

  it("★ 組み立てた列 ID をそのまま渡せば、その列は消えない", () => {
    const { fieldIds } = buildConstructionSlotKeepFieldIds(keepIdOf);
    const { patch } = build({}, fieldIds);

    for (const id of fieldIds) {
      expect(patch).not.toHaveProperty(id);
    }
  });

  it("解決できない列は unresolved で返す（守りが効かないことを知らせる）", () => {
    const { fieldIds, unresolved } = buildConstructionSlotKeepFieldIds((key) =>
      key === "importKey" ? null : keepIdOf(key),
    );

    expect(fieldIds).toEqual([START_DATE, CONTRACTOR]);
    expect(unresolved).toEqual(["importKey"]);
  });

  it("同じ列を返しても重複しない", () => {
    const { fieldIds } = buildConstructionSlotKeepFieldIds(() => START_DATE);

    expect(fieldIds).toEqual([START_DATE]);
  });
});
