import "server-only";

import type { AtPocketRecordRow } from "@/lib/atpocket";
import { atPocketRecordIdFromRow } from "@/lib/atpocket-record-id";
import type { ConstructionFieldIds } from "@/lib/calendar-kojo";
import { pickRecordValueByFieldAliases } from "@/lib/calendar-kojo";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
import type { CustomerCrmCandidate } from "@/lib/customer-crm-list";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { normalizeDateForInput } from "@/lib/customer-info-form/resolve-fields";
import { coerceCustomerInfoDisplayString } from "@/lib/customer-info-record";
import { normalizeDateTimeForPocketField } from "@/lib/jst-hm";

/**
 * 施工管理タブ（足場設置日・足場解体日・施工予定日を1つの月間カレンダーで見る）
 * の応答を組み立てる。
 *
 * ここは @pocket を呼ばない。材料（お客様情報のスナップショット・工事レコード・
 * 名簿の対応表）は呼び出し側が既存のキャッシュから渡す。
 */

/** 名簿にいない・勤務場所が空の担当者の案件をまとめる枠 */
export const CONSTRUCTION_MANAGEMENT_OTHER_BRANCH = "その他";

export type ConstructionManagementEventKind =
  | "scaffoldInstall"
  | "scaffoldRemoval"
  | "construction";

export type ConstructionManagementEvent = {
  /** 画面のキー用。区分＋レコードID（@pocket へのリンクには使わない） */
  id: string;
  kind: ConstructionManagementEventKind;
  /** JST の YYYY-MM-DD */
  dayKey: string;
  customerName: string;
  tNumber: string;
  /**
   * この予定が属する支店（AP担当者の支店と CL担当者の支店の和集合）。
   *
   * ⚠ 1件が2支店に属することがある。支店ごとの件数を足しても
   *    全体の件数とは一致しない。
   */
  branches: string[];
  scaffoldContractor: string;
  scaffoldRequest: string;
  /** 施工業者（施工予定のみ。足場の予定では空） */
  constructionContractor: string;
  /** 施工予定のみ: お客様情報に同じ T番号 のレコードが見つかったか */
  customerMatched: boolean;
  /** 同じ T番号 の工事レコードが、この月の材料に2件以上ある */
  duplicateConstructionTNumber: boolean;
  /** 同じ T番号 のお客様情報レコードが2件以上ある */
  duplicateCustomerTNumber: boolean;
  /**
   * このお客様の3つの日付（詳細表示用。JST の YYYY-MM-DD）。
   *
   * dayKey と違い、表示中の月の外の日付も入る。null は未登録（または読めない値）。
   *   - 足場設置日・足場解体日: お客様情報の値
   *   - 施工予定日: その月の工事レコードにあればその値。無ければお客様情報の
   *     「施工予定日」列（工事登録アプリからの写し）
   * 同じ T番号 のお客様情報が複数あるときは、先頭の1件の値を使う
   * （duplicateCustomerTNumber で分かる）。
   */
  dates: ConstructionManagementEventDates;
};

export type ConstructionManagementEventDates = {
  scaffoldInstall: string | null;
  construction: string | null;
  scaffoldRemoval: string | null;
};

export type ConstructionManagementCounts = Record<
  ConstructionManagementEventKind,
  number
>;

export type ConstructionManagementPayload = {
  year: number;
  month: number;
  events: ConstructionManagementEvent[];
  /**
   * 区分ごとの件数。日付が未登録の案件は数えない。
   * 同じお客様に3種類の予定があれば、それぞれの区分で1件ずつ数える。
   */
  counts: ConstructionManagementCounts;
  /**
   * 支店の一覧。名簿の勤務場所の登録順で、該当する予定がある月だけ
   * 末尾に「その他」を足す。
   */
  branches: string[];
  /** ログイン中の人の勤務場所（初期表示用）。引けなければ null */
  selfWorkplace: string | null;
  /** 同じ T番号 が複数あった組の数（工事レコード側・お客様情報側） */
  duplicateTNumberGroups: { construction: number; customer: number };
  correlationId: string;
};

export type ConstructionManagementInput = {
  year: number;
  month: number;
  /** お客様情報の全件スナップショット（担当者で絞る前） */
  customers: readonly CustomerCrmCandidate[];
  apFieldId: string | null;
  clFieldId: string | null;
  /** 本体カレンダーと同じ列・query で取った工事レコード */
  constructionRecords: readonly AtPocketRecordRow[];
  constructionFieldIds: ConstructionFieldIds;
  /**
   * 正規化済みの氏名（normApClStaffName）→ 勤務場所。
   * 名簿にいない・勤務場所が空なら null を返すこと。
   */
  workplaceOfStaff: (normalizedName: string) => string | null;
  /** 名簿の勤務場所の一覧（listStaffWorkplacesInRosterOrder） */
  rosterWorkplaces: readonly string[];
  selfWorkplace: string | null;
  correlationId: string;
};

/**
 * @pocket の日付の値を JST の YYYY-MM-DD にする。読めなければ null。
 *
 * 新しい日付処理は作らず、既存の関数をつなぐだけにしている。
 *   - normalizeDateTimeForPocketField: Z・オフセット付きの日時を JST に変換
 *   - normalizeDateForInput: YYYY/MM/DD などを YYYY-MM-DD にそろえる
 *   - optionalCalendarYmd: 実在する日付かを確かめる
 */
export function jstDayKeyFromPocketDate(raw: unknown): string | null {
  const s = coerceCustomerInfoDisplayString(raw);
  if (!s) return null;
  return optionalCalendarYmd(
    normalizeDateForInput(normalizeDateTimeForPocketField(s, "Date")),
  );
}

/** T番号 の突き合わせ用（キャンセルされた T番号 の判定と同じ正規化） */
function tNumberKey(raw: string): string {
  return normApClStaffName(raw);
}

function monthPrefix(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-`;
}

function staffName(
  audience: Record<string, unknown>,
  fieldId: string | null,
): string {
  if (!fieldId) return "";
  return normApClStaffName(coerceCustomerInfoDisplayString(audience[fieldId]));
}

export function buildConstructionManagementPayload(
  input: ConstructionManagementInput,
): ConstructionManagementPayload {
  const prefix = monthPrefix(input.year, input.month);
  const inMonth = (dayKey: string | null): dayKey is string =>
    Boolean(dayKey && dayKey.startsWith(prefix));

  /**
   * 担当者1人の支店。名簿にいない・勤務場所が空なら「その他」。
   * 担当者の欄が空の人（CL がいない案件など）は支店を持たない。
   */
  const branchCache = new Map<string, string>();
  const branchOf = (name: string): string => {
    const hit = branchCache.get(name);
    if (hit) return hit;
    const w = input.workplaceOfStaff(name)?.trim();
    const branch = w || CONSTRUCTION_MANAGEMENT_OTHER_BRANCH;
    branchCache.set(name, branch);
    return branch;
  };

  /**
   * AP と CL の支店の和集合。どちらの支店で絞っても出るようにする。
   * 担当者が2人とも空なら「その他」。
   */
  const branchesOfCustomer = (c: CustomerCrmCandidate): string[] => {
    const set = new Set<string>();
    for (const fieldId of [input.apFieldId, input.clFieldId]) {
      const name = staffName(c.audience, fieldId);
      if (name) set.add(branchOf(name));
    }
    if (set.size === 0) set.add(CONSTRUCTION_MANAGEMENT_OTHER_BRANCH);
    return [...set];
  };

  // お客様情報を T番号 ごとにまとめる（同じ T番号 が複数あってもすべて持つ）
  const customersByT = new Map<string, CustomerCrmCandidate[]>();
  for (const c of input.customers) {
    const k = tNumberKey(c.tNumber);
    if (!k) continue;
    const list = customersByT.get(k);
    if (list) list.push(c);
    else customersByT.set(k, [c]);
  }
  const duplicateCustomerTs = new Set(
    [...customersByT].filter(([, list]) => list.length > 1).map(([k]) => k),
  );

  const events: ConstructionManagementEvent[] = [];

  // ── 工事レコードを先に読む（足場の予定の詳細で施工予定日を引くため） ──
  const fids = input.constructionFieldIds;
  type ConstructionRow = {
    recordId: string;
    recObj: Record<string, unknown>;
    dayKey: string;
    t: string;
  };
  const constructionRows: ConstructionRow[] = [];
  const constructionCountByT = new Map<string, number>();
  /** T番号 → その月の施工予定日（同じ T番号 が複数あれば先に出た方） */
  const constructionDayByT = new Map<string, string>();
  for (const row of input.constructionRecords) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;
    const recordId = atPocketRecordIdFromRow(row);
    if (!recordId) continue;
    const dayKey = fids.startDate
      ? jstDayKeyFromPocketDate(
          pickRecordValueByFieldAliases(recObj, fids.startDate),
        )
      : null;
    // 本体と同じ query は「月に重なる案件」を返すので、施工予定日で絞り直す
    if (!inMonth(dayKey)) continue;
    const t = fids.tNumber
      ? tNumberKey(
          coerceCustomerInfoDisplayString(
            pickRecordValueByFieldAliases(recObj, fids.tNumber),
          ),
        )
      : "";
    constructionRows.push({ recordId, recObj, dayKey, t });
    if (t) {
      constructionCountByT.set(t, (constructionCountByT.get(t) ?? 0) + 1);
      if (!constructionDayByT.has(t)) constructionDayByT.set(t, dayKey);
    }
  }

  /** お客様1件の3つの日付（詳細表示用。月の外も含む） */
  const datesOfCustomer = (
    c: CustomerCrmCandidate | undefined,
    t: string,
  ): ConstructionManagementEventDates => ({
    scaffoldInstall: jstDayKeyFromPocketDate(c?.scaffold?.installDate ?? ""),
    construction:
      (t ? constructionDayByT.get(t) : undefined) ??
      jstDayKeyFromPocketDate(c?.constructionDate ?? ""),
    scaffoldRemoval: jstDayKeyFromPocketDate(c?.scaffold?.removalDate ?? ""),
  });

  // ── 足場設置・足場解体（お客様情報から） ──
  for (const c of input.customers) {
    // キャンセルされた案件は出さない（未定案件の一覧と同じ）
    if (c.isCancelled) continue;
    // 足場の列を設定していない環境・古い形のデータでは scaffold が無い
    const s = c.scaffold;
    if (!s) continue;
    const t = tNumberKey(c.tNumber);
    const base = {
      customerName: c.customerName,
      tNumber: c.tNumber,
      branches: branchesOfCustomer(c),
      scaffoldContractor: s.contractor,
      scaffoldRequest: s.request,
      constructionContractor: "",
      customerMatched: true,
      duplicateConstructionTNumber: false,
      duplicateCustomerTNumber: Boolean(t && duplicateCustomerTs.has(t)),
      dates: datesOfCustomer(c, t),
    };
    const install = jstDayKeyFromPocketDate(s.installDate);
    if (inMonth(install)) {
      events.push({
        ...base,
        id: `scaffoldInstall:${c.recordId}`,
        kind: "scaffoldInstall",
        dayKey: install,
      });
    }
    const removal = jstDayKeyFromPocketDate(s.removalDate);
    if (inMonth(removal)) {
      events.push({
        ...base,
        id: `scaffoldRemoval:${c.recordId}`,
        kind: "scaffoldRemoval",
        dayKey: removal,
      });
    }
  }

  // ── 施工予定（工事レコードから） ──
  for (const r of constructionRows) {
    const matched = r.t ? (customersByT.get(r.t) ?? []) : [];
    // キャンセルされた T番号 の判定と同じく、1件でもキャンセルなら出さない
    if (matched.some((c) => c.isCancelled)) continue;

    let branches: string[];
    if (matched.length === 0) {
      // お客様情報に無い（T番号 が空・見つからない）。担当者が分からない
      branches = [CONSTRUCTION_MANAGEMENT_OTHER_BRANCH];
    } else {
      // 同じ T番号 のお客様情報が複数あれば、全員の AP/CL の支店を合わせる
      const set = new Set<string>();
      for (const c of matched) for (const b of branchesOfCustomer(c)) set.add(b);
      branches = [...set];
    }

    const title = fids.title
      ? coerceCustomerInfoDisplayString(
          pickRecordValueByFieldAliases(r.recObj, fids.title),
        )
      : "";
    events.push({
      id: `construction:${r.recordId}`,
      kind: "construction",
      dayKey: r.dayKey,
      customerName: title || matched[0]?.customerName || "",
      tNumber: fids.tNumber
        ? coerceCustomerInfoDisplayString(
            pickRecordValueByFieldAliases(r.recObj, fids.tNumber),
          )
        : "",
      branches,
      scaffoldContractor: matched[0]?.scaffold?.contractor ?? "",
      scaffoldRequest: matched[0]?.scaffold?.request ?? "",
      constructionContractor: fids.contractor
        ? coerceCustomerInfoDisplayString(
            pickRecordValueByFieldAliases(r.recObj, fids.contractor),
          )
        : "",
      customerMatched: matched.length > 0,
      duplicateConstructionTNumber: (constructionCountByT.get(r.t) ?? 0) > 1,
      duplicateCustomerTNumber: Boolean(r.t && duplicateCustomerTs.has(r.t)),
      dates: {
        ...datesOfCustomer(matched[0], ""),
        // 施工予定日はこの工事レコード自身の値
        construction: r.dayKey,
      },
    });
  }

  const kindOrder: Record<ConstructionManagementEventKind, number> = {
    scaffoldInstall: 0,
    construction: 1,
    scaffoldRemoval: 2,
  };
  events.sort(
    (a, b) =>
      a.dayKey.localeCompare(b.dayKey) ||
      kindOrder[a.kind] - kindOrder[b.kind] ||
      a.id.localeCompare(b.id),
  );

  const counts: ConstructionManagementCounts = {
    scaffoldInstall: 0,
    scaffoldRemoval: 0,
    construction: 0,
  };
  for (const e of events) counts[e.kind] += 1;

  // 「その他」は該当する予定がある月だけ一覧に入れる
  const branches = [...input.rosterWorkplaces];
  const hasOther = events.some((e) =>
    e.branches.includes(CONSTRUCTION_MANAGEMENT_OTHER_BRANCH),
  );
  if (hasOther && !branches.includes(CONSTRUCTION_MANAGEMENT_OTHER_BRANCH)) {
    branches.push(CONSTRUCTION_MANAGEMENT_OTHER_BRANCH);
  }

  return {
    year: input.year,
    month: input.month,
    events,
    counts,
    branches,
    selfWorkplace: input.selfWorkplace,
    duplicateTNumberGroups: {
      construction: [...constructionCountByT.values()].filter((n) => n > 1)
        .length,
      customer: duplicateCustomerTs.size,
    },
    correlationId: input.correlationId,
  };
}

/**
 * 支店で絞る。AP か CL のどちらかの支店が一致すれば含める。
 *
 * ⚠ 1件が2支店に出るので、支店ごとの件数を足しても全体の件数とは一致しない。
 */
export function filterConstructionManagementEventsByBranch(
  events: readonly ConstructionManagementEvent[],
  branch: string,
): ConstructionManagementEvent[] {
  return events.filter((e) => e.branches.includes(branch));
}
