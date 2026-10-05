import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 第3段階 3-3 の配線（ソースを直接見る）。
 *
 * 挙動ではなく**どこへ繋がっているか**を固定する。ここが狂うと、
 * 画面が「空き枠を削除する旧ルート」へ戻ったことに誰も気づけない。
 * レンダリングを組まずに済む代わり、対象は文字列一致に限っている。
 *
 * 3-4 で旧ルートを撤去したら、このファイルの「残っている」側の
 * 確認も一緒に外すこと。
 */

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const CALL_SITES = [
  "src/components/calendar-assign-undated-case-form.tsx",
  "src/components/liff-calendar-month-page.tsx",
] as const;

const OLD_ROUTE_PATHS = [
  "/api/calendar/assign-case-to-slot",
  "/api/calendar/schedule-undated-case",
] as const;

describe("画面の送信先（3-3）", () => {
  it("★ 2箇所とも新ルートへ送っている", () => {
    for (const rel of CALL_SITES) {
      const src = read(rel);
      expect(
        src.includes("ASSIGN_CUSTOMER_CASE_PATH") ||
          src.includes("/api/calendar/assign-customer-case"),
        `${rel} が新ルートを参照していない`,
      ).toBe(true);
    }
  });

  it("★ 旧ルートを呼んでいない", () => {
    for (const rel of CALL_SITES) {
      const src = read(rel);
      for (const oldPath of OLD_ROUTE_PATHS) {
        expect(src.includes(oldPath), `${rel} が ${oldPath} を呼んでいる`).toBe(
          false,
        );
      }
    }
  });

  it("★ 空き枠の確認ダイアログを使っていない", () => {
    const src = read("src/components/calendar-assign-undated-case-form.tsx");
    expect(src).not.toContain("CalendarEmptySlotConfirmDialog");
  });

  it("★ 「空き枠は削除されます」の文言が残っていない", () => {
    for (const rel of CALL_SITES) {
      expect(read(rel), `${rel} に削除前提の文言が残っている`).not.toContain(
        "空き枠は削除されます",
      );
    }
  });
});

describe("旧経路は残してある（撤去は 3-4）", () => {
  it("★ 旧ルートのファイルを消していない", () => {
    for (const rel of [
      "src/app/api/calendar/assign-case-to-slot/route.ts",
      "src/app/api/calendar/schedule-undated-case/route.ts",
    ]) {
      expect(existsSync(path.join(ROOT, rel)), `${rel} が無い`).toBe(true);
    }
  });

  it("★ 旧の抽出処理を消していない", () => {
    const src = read("src/lib/calendar-undated-cases.ts");
    expect(src).toContain("export function buildUndatedConstructionCases");
  });

  it("空き枠入力（fill-empty-slot）はそのまま残っている", () => {
    expect(
      existsSync(
        path.join(ROOT, "src/app/api/calendar/fill-empty-slot/route.ts"),
      ),
    ).toBe(true);
    // 空き枠カードの「新規入力」は従来どおりこちらへ送る
    expect(read("src/components/liff-calendar-month-page.tsx")).toContain(
      "/api/calendar/fill-empty-slot",
    );
  });

  it("新規登録（create-record）はそのまま残っている", () => {
    expect(read("src/components/liff-calendar-month-page.tsx")).toContain(
      "/api/calendar/create-record",
    );
  });
});

/**
 * 3-3 では「deleteRecord を呼ぶのは assign-case-to-slot だけ」を固定していた。
 * 案B で assign-customer-case にも削除が入ったため、**呼んでよい経路の一覧**
 * を固定する形へ置き換える。増えたことに誰も気づけない状態にはしない。
 */
describe("物理削除の呼び出し口（案B）", () => {
  /**
   * deleteRecord を呼んでよい経路。ここを増やすときは必ず理由を書くこと。
   *
   * 1. assign-case-to-slot   旧経路。使った空き枠を消す
   * 2. assign-customer-case  案B。既存レコードへ書いたあと空き枠を消す
   * 3. move-construction-case
   *    M-4。移動元を空き枠へ戻すと元の日の枠数が減らないため、
   *    「削除する」を選べるようにした。**既定は残す**で、明示的に
   *    選ばれ、かつ calendar-move-source-disposition の判定を
   *    すべて通ったときだけ消す。1〜2 と違い、消すのは
   *    **お客様名が入っている案件レコード**なので条件は逆向き。
   * 4. customer-cancel-server（ルートではなく lib）
   *    顧客ステータスをキャンセルにしたとき、その案件の工事レコードを消す。
   *    以前は3項目を空にして残していたが、お客様名と T番号 が残って
   *    空き枠にもならず宙に浮いていた。3 と同じく消すのは案件レコード。
   *    同じ案件のレコードが複数あるとき・削除ログを残せないときは消さない
   *    （customer-cancel-delete-guard の判定をすべて通ったときだけ）。
   */
  const DELETE_ALLOWED = [
    "src/app/api/calendar/assign-case-to-slot/route.ts",
    "src/app/api/calendar/assign-customer-case/route.ts",
    "src/app/api/calendar/move-construction-case/route.ts",
    "src/lib/customer-cancel-server.ts",
  ] as const;

  /** 削除を1件も増やさない設計にした経路 */
  const DELETE_FORBIDDEN = [
    "src/app/api/calendar/fill-empty-slot/route.ts",
    "src/app/api/calendar/schedule-undated-case/route.ts",
    "src/app/api/calendar/create-record/route.ts",
  ] as const;

  it("★ 削除を呼ぶのは許可した4経路だけ", () => {
    for (const rel of DELETE_FORBIDDEN) {
      const src = read(rel);
      expect(src, `${rel} が deleteRecord を呼んでいる`).not.toContain(
        "deleteRecord(",
      );
    }
    for (const rel of DELETE_ALLOWED) {
      expect(read(rel), `${rel} が deleteRecord を呼んでいない`).toContain(
        "deleteRecord(",
      );
    }
  });

  it("★ assign-customer-case の削除は判定関数と削除ログを通る", () => {
    const route = read("src/app/api/calendar/assign-customer-case/route.ts");
    // 可否判定を素通しして消していない
    expect(route).toContain("decideEmptySlotDeletion");
    // A-4: 全項目を記録できたときだけ消す
    expect(route).toContain("formatDeletionContent");
    expect(route).toContain("if (!deletionLog.ok)");
    // 止められる形になっている
    expect(route).toContain("assignDeletesEmptySlotEnabled");
  });

  /**
   * キャンセル時の削除（4）。消すのは案件レコードで、戻せない。
   * 作法は他の経路と同じ（A-4）であることを固定する
   */
  it("★ キャンセル時の削除は判定関数と削除ログを通る", () => {
    const src = read("src/lib/customer-cancel-server.ts");
    // 可否判定を素通しして消していない
    expect(src).toContain("decideCancelConstructionDeletion");
    // A-4: 全項目を記録できたときだけ消す
    expect(src).toContain("formatDeletionContent");
    expect(src).toContain("if (!deletionLog.ok)");
    // 止められる形になっている
    expect(src).toContain("customerCancelDeletesConstructionRecordEnabled");
  });

  it("★ キャンセル時の削除は1箇所だけ", () => {
    const src = read("src/lib/customer-cancel-server.ts");

    expect(src.split("await deleteRecord(").length - 1).toBe(1);
    expect(src).toContain("deleteConstructionRecordForCancel");
  });

  it("★ キャンセル時の削除は、判定 → 削除ログ → 削除 の順に書かれている", () => {
    const src = read("src/lib/customer-cancel-server.ts");
    const fn = src.slice(
      src.indexOf("async function deleteConstructionRecordForCancel"),
    );

    const decideAt = fn.indexOf("decideCancelConstructionDeletion(");
    const logAt = fn.indexOf('operation: "delete"');
    const guardAt = fn.indexOf("if (!deletionLog.ok)");
    const deleteAt = fn.indexOf("await deleteRecord(");
    for (const at of [decideAt, logAt, guardAt, deleteAt]) {
      expect(at).toBeGreaterThan(-1);
    }
    expect(decideAt).toBeLessThan(logAt);
    expect(logAt).toBeLessThan(guardAt);
    expect(guardAt).toBeLessThan(deleteAt);
  });

  it("★ 削除の判定と止めるスイッチは、判定モジュールに閉じている", () => {
    const guard = read("src/lib/customer-cancel-delete-guard.ts");

    expect(guard).toContain("export function decideCancelConstructionDeletion");
    expect(guard).toContain("CUSTOMER_CANCEL_DELETE_CONSTRUCTION_RECORD");
    // 判定しかしない（@pocket の読み書きを持ち込まない）
    expect(guard).not.toContain("@/lib/atpocket");
  });

  it("★ 空き枠を案件に変える経路では消さない", () => {
    const route = read("src/app/api/calendar/assign-customer-case/route.ts");
    // 削除は「既存レコードへ書いたあと」の1箇所だけ
    expect(route.split("await deleteRecord(").length - 1).toBe(1);
    expect(route).toContain("deleteEmptySlotAfterExistingWrite");
  });
});

/**
 * M-4 の削除は、案B と同じ作法（A-4）を通ることを固定する。
 * 消す対象が案件レコードなので、条件が逆向きであることも見る。
 */
describe("移動元の削除（M-4）", () => {
  const ROUTE = "src/app/api/calendar/move-construction-case/route.ts";

  it("★ 判定関数を素通しして消していない", () => {
    const src = read(ROUTE);

    expect(src).toContain("decideMoveSourceDeletion");
    expect(src).toContain("if (deleteDecision.ok && freshSourceRecord)");
  });

  it("★ A-4: 全項目を記録できたときだけ消す", () => {
    const src = read(ROUTE);

    expect(src).toContain("formatDeletionContent");
    expect(src).toContain("if (!deletionLog.ok)");
    // 削除ログはベストエフォートの箱に入れない（ok を見る前に消える）
    expect(src).not.toContain("auditTasks.push(\n        recordAuditLog(");
  });

  it("★ 削除の直前に CSV 指定なしで取り直す", () => {
    const src = read(ROUTE);

    expect(src).toContain(
      "await fetchRecordById(calAppId, sourceRecordId, readAuth)",
    );
  });

  it("★ 止められる形になっている", () => {
    expect(read(ROUTE)).toContain("moveDeletesSourceRecordEnabled");
  });

  it("★ 空き枠を消す判定を流用していない（条件が逆向き）", () => {
    const src = read(ROUTE);

    expect(src).not.toContain("decideEmptySlotDeletion");
    expect(src).not.toContain("calendar-assign-slot-delete-guard");
  });

  it("★ 既定は「残す」（送られてこなければ消さない）", () => {
    const src = read(ROUTE);

    expect(src).toContain("moveSourceDispositionFromBody");
    expect(read("src/lib/calendar-move-source-disposition.ts")).toContain(
      'raw.trim() === "delete" ? "delete" : "keep"',
    );
  });
});
