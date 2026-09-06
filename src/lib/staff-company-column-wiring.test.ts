import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 所属会社（AP所属会社・CL所属会社）の配線。
 *
 * 名簿の取得列を1つ足す変更は、**キャッシュのバージョンを上げないと効かない**。
 * rosterCacheKey に取得列の CSV そのものは入っていないため、上げずに足すと
 * 列を含まない既存キャッシュが最大30分（429 時のフォールバックなら最大6時間）
 * 返り続け、その間ずっと会社が空で引けない。
 *
 * 挙動ではなく**どこに列が入っているか**を固定する（対象は文字列一致）。
 */

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("名簿の取得列", () => {
  const src = read("src/lib/staff-roster-cache.ts");

  it("★ 取得列の CSV に所属会社が入っている", () => {
    // staffRosterListFieldsCsv と staffRosterUseExtendedFieldsCsv の両方
    // （説明のための言及ではなく、env キーの一覧に入っている数を数える）
    expect(src.split('"STAFF_COMPANY_FIELD_ID",').length - 1).toBe(2);
  });

  it("★ 列を足したのでキャッシュのバージョンが上がっている", () => {
    // 上げ忘れると、会社列を含まない既存キャッシュが返り続ける
    expect(src).toContain('const STAFF_ROSTER_FIELDS_CSV_VERSION = "6";');
  });

  it("名簿の他の利用者が読む列は落としていない", () => {
    for (const envKey of [
      "STAFF_WORKPLACE_FIELD_ID",
      "STAFF_DEPARTMENT_FIELD_ID",
      "STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID",
      "STAFF_PIN_HASH_FIELD_ID",
      "STAFF_AVAILABILITY_FIELD_ID",
    ]) {
      expect(src, envKey).toContain(envKey);
    }
  });
});

describe("名簿からの引き方", () => {
  const src = read("src/lib/staff-workplace-lookup.ts");

  it("★ 支店と会社を1回の走査でまとめて引く", () => {
    expect(src).toContain("lookupStaffAssignmentByStaffName");
    expect(src).toContain("resolveStaffAssignmentLookupConfig");
    // 未設定なら見出し「所属会社」で解決する
    expect(src).toContain('const STAFF_COMPANY_CAPTIONS = ["所属会社"];');
  });

  it("★ 出勤打刻が使う勤務場所の入口はそのまま残っている", () => {
    // 打刻通知の支社の行が使う。挙動を変えないため別に残してある
    expect(src).toContain("export async function lookupStaffWorkplaceByStaffName");
    expect(src).toContain(
      "export async function resolveStaffWorkplaceLookupConfig",
    );
  });
});

describe("お客様情報への書き込み", () => {
  it("★ 保存時の自動入力は支店と会社を1つの処理で扱う", () => {
    const src = read("src/lib/customer-info-form/put-payload.ts");

    expect(src).toContain("applyStaffAssignmentsToPayload");
    // 支店だけを扱う旧関数に戻さない（片方だけ直す事故を防ぐ）
    expect(src).not.toContain("applyStaffBranchesToPayload");
    expect(src).toContain('companyKey: "apCompany"');
    expect(src).toContain('companyKey: "clCompany"');
  });

  it("★ 担当者の送信ガードより前に置く（順序を変えない）", () => {
    const src = read("src/lib/customer-info-form/put-payload.ts");

    const assignments = src.indexOf("await applyStaffAssignmentsToPayload(");
    const guard = src.indexOf("applyApClStaffGuardToPayload(resolved,");
    expect(assignments).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
    expect(assignments).toBeLessThan(guard);
  });

  it("★ 工事カレンダー起点の新規作成でも会社を入れる", () => {
    const src = read("src/lib/sync-construction-to-customer-info.ts");

    expect(src).toContain('"apCompany"');
    expect(src).toContain('"AP所属会社"');
    expect(src).toContain('"clCompany"');
    expect(src).toContain('"CL所属会社"');
  });

  it("★ スキーマは画面に出さない（hiddenInForm）", () => {
    const src = read("src/lib/customer-info-form/schema.ts");

    for (const key of ["apCompany", "clCompany"]) {
      const at = src.indexOf(`key: "${key}"`);
      expect(at, key).toBeGreaterThan(-1);
      // key の直後のブロックに hiddenInForm がある
      expect(src.slice(at, at + 160), key).toContain("hiddenInForm: true");
    }
  });
});
