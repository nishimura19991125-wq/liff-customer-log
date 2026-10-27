import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  isPocketRateLimitMessage,
  safePocketErrorTextWithId,
} from "@/lib/api-error-response";
import {
  apiKeyForCalendarPocket,
  apiKeyForCalendarReportPocket1,
  fetchAppFields,
} from "@/lib/atpocket";
import { fetchCalendarConstructionRecordsCached } from "@/lib/calendar-construction-records-cache";
import {
  buildConstructionRecordsMonthOverlapQuery,
  collectConstructionFieldsCsv,
  collectReportFieldsCsv,
  resolveConstructionFieldIds,
  resolveReportFieldIds,
} from "@/lib/calendar-kojo";
import { fetchCalendarReportRecordsCached } from "@/lib/calendar-report-records-cache";
import {
  buildZankoReportFacts,
  type ZankoReportFacts,
} from "@/lib/zanko-report";
import {
  buildConstructionManagementPayload,
  CONSTRUCTION_MANAGEMENT_VISIBLE_BRANCHES_ENV,
  resolveConstructionManagementVisibleBranches,
} from "@/lib/construction-management";
import { getCachedCustomerCrmSnapshot } from "@/lib/customer-crm-list";
import { customerInfoConfigReady } from "@/lib/customer-info-config";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { coerceCustomerInfoDisplayString } from "@/lib/customer-info-record";
import { resolveConstructionMapAddressFieldIds } from "@/lib/map-address-fields";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";
import { fetchStaffRosterRowsCached } from "@/lib/staff-roster-cache";
import {
  listStaffWorkplacesInRosterOrder,
  lookupStaffAssignmentByStaffName,
  resolveStaffAssignmentLookupConfig,
} from "@/lib/staff-workplace-lookup";
import {
  failedZankoCalendarSources,
  readZankoCalendarSources,
} from "@/lib/zanko-calendar-sources";
import { buildZankoCaseEntries } from "@/lib/zanko-cards";

export const dynamic = "force-dynamic";

const SCOPE = "api/calendar/construction-management";

/**
 * 施工管理タブ（足場設置日・足場解体日・施工予定日）の読み取り専用 API。
 *
 * ■ @pocket への全件取得を増やさない
 * 材料はすべて既存のキャッシュから取る。
 *   - 施工予定: 本体カレンダー（/api/calendar）と**同じ列・同じ query** で
 *     工事レコードのキャッシュを読む。キャッシュは1件分だけなので、
 *     別の列や query で呼ぶと本体のキャッシュを追い出してしまう。
 *   - 足場: お客様情報の全件スナップショット（担当顧客一覧などと共有・最大10分遅れ）
 *     をメモリ上で月ごとに絞る。お客様情報は query が無視された記録があるため
 *     query では絞らない。
 *   - 支店: 名簿のキャッシュ（AP/CL担当者の氏名から引く）
 *
 * ■ 「予定が無い」と「取得に失敗した」を分ける
 * 予定が無い月は 200 で events: []。取得に失敗したときは空の結果を返さず、
 * 429 / 502 / 503 と相関ID付きの文言を返す。
 * 名簿が引けないときもエラーにする。全員を「その他」にして成功として返すと、
 * 名簿の不具合と本当に未所属の人とが見分けられなくなるため。
 */
function errorResponse(
  status: number,
  message: string,
  correlationId: string,
): NextResponse {
  return NextResponse.json({ error: message, correlationId }, { status });
}

function unavailable(reason: string): NextResponse {
  const correlationId = randomUUID().slice(0, 8);
  // 理由は固定の短い語だけ。環境変数名や値は出さない
  console.warn(`[${SCOPE}] correlationId=${correlationId} unavailable=${reason}`);
  return errorResponse(
    503,
    `施工管理は現在利用できません（ID: ${correlationId}）`,
    correlationId,
  );
}

/**
 * 工事報告の材料（残工 段階4-b）。完了報告によるグレー・⚠️ のスキップと、
 * 完工報告による延期扱いの解除に使う。
 *
 * 工事カレンダー（/api/calendar）と同じ列・同じキャッシュ
 * （fetchCalendarReportRecordsCached。キーはアプリID＋列の一覧）で読む。
 * 工事カレンダーを先に開いていれば @pocket の呼び出しは増えない。
 * キャッシュが空のときだけ、列定義1回（30分キャッシュ）＋全件の一覧
 * （1000件ごとに1回）が増える。
 *
 * 失敗しても投げない（null＝「報告なし」。施工管理全体は表示する）。
 */
async function readReportFactsForManagement(): Promise<ZankoReportFacts | null> {
  const reportAppId = process.env.CALENDAR_REPORT_APP_ID?.trim();
  if (!reportAppId) return null;
  try {
    const fields = await fetchAppFields(
      reportAppId,
      { apiKey: apiKeyForCalendarReportPocket1() },
      // 工事カレンダーと同じ操作名にそろえる（ログで同じ取得と分かるように）
      { operation: "calendar:工事報告fields", appEnv: "CALENDAR_REPORT_APP_ID" },
    );
    const csv = collectReportFieldsCsv(resolveReportFieldIds(fields));
    if (!csv) return null;
    const rows = await fetchCalendarReportRecordsCached(reportAppId, csv);
    return buildZankoReportFacts(rows, fields);
  } catch (e) {
    console.error(`[${SCOPE}] 工事報告を読めませんでした（報告なしとして扱う）`, e);
    return null;
  }
}

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  if (
    !Number.isInteger(year) ||
    year < 1990 ||
    year > 2100 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return NextResponse.json(
      { error: "クエリ year（年）と month（1〜12）を指定してください" },
      { status: 400 },
    );
  }

  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (!calAppId) return unavailable("calendar");
  if (!customerInfoConfigReady().ok) return unavailable("customer-info");

  // 本体カレンダーと同じ判定（CALENDAR_RECORDS_QUERY_FILTER=false なら query なし）
  const recordsQueryFilterEnabled =
    process.env.CALENDAR_RECORDS_QUERY_FILTER?.trim() !== "false";

  try {
    // 工事報告（段階4-b）は工事レコードの取得と並べて読む。失敗しても投げない
    const reportFactsPromise = readReportFactsForManagement();

    // ── 施工予定: 本体カレンダーと同じ列・同じ query ──
    const constructionFields = await fetchAppFields(
      calAppId,
      { apiKey: apiKeyForCalendarPocket() },
      { operation: "calendar:施工管理fields", appEnv: "CALENDAR_APP_ID" },
    );
    const fids = resolveConstructionFieldIds(constructionFields);
    const csv = collectConstructionFieldsCsv(
      fids,
      resolveConstructionMapAddressFieldIds(constructionFields),
    );
    const pocketQuery = recordsQueryFilterEnabled
      ? buildConstructionRecordsMonthOverlapQuery(fids, year, month)
      : undefined;
    const constructionRecords = await fetchCalendarConstructionRecordsCached(
      calAppId,
      csv,
      pocketQuery,
    );

    // ── 足場: お客様情報の全件スナップショット ──
    const snapshot = await getCachedCustomerCrmSnapshot();

    /**
     * 残工の材料（186・契約情報入力。残工 段階2）。工事カレンダーと同じ部品で、
     * 同じキャッシュから読む。契約情報は上で読んだ全件キャッシュを渡し、
     * 二重に読まない。186 は名簿の取得と並べて読む。
     * 失敗しても投げない（186 が読めなければ残工は出ない）。
     */
    const zankoSourcesPromise = readZankoCalendarSources({
      customerSnapshot: Promise.resolve(snapshot),
    }).catch((e) => {
      console.error(`[${SCOPE}] 残工の材料を読めませんでした`, e);
      return failedZankoCalendarSources();
    });

    // ── 支店: 名簿 ──
    const rosterRows = await fetchStaffRosterRowsCached();
    // 名簿は 429 で古い名簿も無いとき空で返る。空のまま進めると全員が
    // 「その他」に落ちるので、引けなかったものとして扱う
    if (rosterRows.length === 0) return unavailable("roster-empty");
    const staffCfg = await resolveStaffAssignmentLookupConfig();
    if (!staffCfg?.workplaceFieldId) return unavailable("roster-config");

    const workplaceByName = new Map<string, string | null>();
    for (const c of snapshot.items) {
      for (const fieldId of [snapshot.apFieldId, snapshot.clFieldId]) {
        if (!fieldId) continue;
        const name = normApClStaffName(
          coerceCustomerInfoDisplayString(c.audience[fieldId]),
        );
        if (!name || workplaceByName.has(name)) continue;
        const a = await lookupStaffAssignmentByStaffName(name, staffCfg);
        workplaceByName.set(name, a.workplace);
      }
    }
    const rosterWorkplaces = await listStaffWorkplacesInRosterOrder();
    // 表示する支店（未設定なら名簿の勤務場所をそのまま使う）
    const visible = resolveConstructionManagementVisibleBranches(
      rosterWorkplaces,
      process.env[CONSTRUCTION_MANAGEMENT_VISIBLE_BRANCHES_ENV],
    );

    const selfName = await resolveBoundStaffNameForLineUser(auth.lineUserId);
    const selfWorkplace = selfName
      ? ((await lookupStaffAssignmentByStaffName(selfName, staffCfg)).workplace ??
        null)
      : null;

    const zankoSources = await zankoSourcesPromise;
    const reportFacts = await reportFactsPromise;

    const correlationId = randomUUID().slice(0, 8);
    const payload = buildConstructionManagementPayload({
      year,
      month,
      customers: snapshot.items,
      apFieldId: snapshot.apFieldId,
      clFieldId: snapshot.clFieldId,
      constructionRecords,
      constructionFieldIds: fids,
      workplaceOfStaff: (name) => workplaceByName.get(name) ?? null,
      rosterWorkplaces,
      visibleBranches: visible.visibleBranches,
      selfWorkplace,
      // 勤務場所を引くために上で取った氏名をそのまま使う（取得は増えない）
      selfStaffName: selfName,
      // 【延期】・グレーの判定（186 が読めなければ空なので付かない）
      zankoIndex: zankoSources.zanko.index,
      zankoReportFacts: reportFacts,
      // 工事カレンダーと同じ部品で表示月の残工を決める
      zankoEntries: buildZankoCaseEntries(
        zankoSources.zanko.index,
        zankoSources.contract.byT,
        year,
        month,
        reportFacts,
      ),
      correlationId,
    });

    // 件数と真偽値だけを残す（氏名・T番号・環境変数の値は出さない）
    console.info(
      `[${SCOPE}] correlationId=${correlationId}`,
      JSON.stringify({
        year,
        month,
        scaffoldInstall: payload.counts.scaffoldInstall,
        scaffoldRemoval: payload.counts.scaffoldRemoval,
        construction: payload.counts.construction,
        zanko: payload.counts.zanko,
        hasReportFacts: reportFacts !== null,
        zankoSource: zankoSources.zanko.status,
        contractSource: zankoSources.contract.status,
        duplicateConstructionTNumberGroups:
          payload.duplicateTNumberGroups.construction,
        duplicateCustomerTNumberGroups: payload.duplicateTNumberGroups.customer,
        unmatchedConstruction: payload.events.filter(
          (e) => e.kind === "construction" && !e.customerMatched,
        ).length,
        hasOtherBranch: payload.branches.includes("その他"),
        hasSelfWorkplace: payload.selfWorkplace !== null,
        // 氏名そのものは出さない。取れたかどうかだけ
        hasSelfStaffName: Boolean(payload.selfStaffName),
        // 表示する支店の指定。支店名は出さず、指定の有無と名簿に無かった数だけ
        visibleBranchesConfigured: visible.visibleBranches !== null,
        visibleBranchesMissing: visible.missingCount,
      }),
    );

    return NextResponse.json(payload);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const { text, correlationId } = safePocketErrorTextWithId(e, {
      scope: SCOPE,
      message:
        "施工管理のデータ取得に失敗しました。しばらくしてから再度お試しください。",
    });
    if (isPocketRateLimitMessage(raw)) {
      const res = errorResponse(429, text, correlationId);
      res.headers.set("Retry-After", "120");
      return res;
    }
    return errorResponse(502, text, correlationId);
  }
}
