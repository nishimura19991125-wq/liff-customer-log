import { NextResponse } from "next/server";

/**
 * 【一時的な調査用ルート】
 *
 * このルートは「目標登録(月次)」アプリの構成を調査するための一時的なものです。
 * **調査完了後に削除してください。**
 * PROBE_ENABLED が未設定なら 404 を返します。
 *
 * scripts/sales-target/probe-target-app.mjs と同じ内容を返します。
 * ローカルからは @pocket の API キーを取り出せない（Netlify のシークレット
 * 変数は管理画面でもマスクされる）ため、Netlify 上で動かして呼び出します。
 *
 * フォルダ名が `%5Fprobe` なのは Next.js の仕様によるものです。
 * `_` 始まりのフォルダは private folder としてルーティングから除外されるため、
 * URL に `_` を出すには `%5F`（アンダースコアの URL エンコード）を使います。
 * 実際のパスは /api/_probe/sales-target になります。
 *
 * 呼び出し方:
 *   GET /api/_probe/sales-target            調査結果を返す
 *   GET /api/_probe/sales-target?check=1    有効かどうかだけ返す（@pocket は呼ばない）
 *
 * 安全策:
 *   - PROBE_ENABLED=1 のときだけ動作する。未設定なら 404（存在しないルートと
 *     区別が付かないよう、認証より前に判定する）
 *   - LINE 認証必須（未認証は 401）。さらにスタッフ名簿への紐付け必須（無ければ 403）
 *   - 担当者名は伏せ字にして返す。部署・支社は個人情報ではないためそのまま返す
 *   - @pocket のエラー本文はレスポンスに載せない（環境変数名などが混ざるため）
 *   - fields と records の参照のみ。作成・更新・削除の API は呼ばない
 */

import {
  apiKeyForAppFields,
  fetchAppFields,
  fetchRecordsList,
  type AtPocketFieldRow,
} from "@/lib/atpocket";
import { pickRecordValueByFieldAliases } from "@/lib/calendar-kojo";
import { coerceCustomerInfoDisplayString } from "@/lib/customer-info-record";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

/** 調査したい列の見出し（K-1 で提示された画面上の列名） */
const TARGET_CAPTIONS = {
  month: "目標月",
  department: "部署",
  branch: "支社",
  staffName: "担当者名",
  apoCount: "アポ獲得件数",
  workDays: "稼働予定日数",
  pt: "目標粗利",
  contractCount: "成約件数",
  avgPt: "平均粗利",
} as const;

type TargetColumnKey = keyof typeof TARGET_CAPTIONS;

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function findFieldByCaption(
  fields: AtPocketFieldRow[],
  caption: string,
): AtPocketFieldRow | null {
  const want = nfkc(caption).toLowerCase();
  for (const f of fields) {
    if (f.caption && nfkc(String(f.caption)).toLowerCase() === want) return f;
  }
  return null;
}

/** 1文字目だけ残して伏せる。氏名をレスポンスに出さないため */
function maskName(name: string): string {
  const chars = [...name];
  if (chars.length === 0) return "";
  return `${chars[0]}${"○".repeat(Math.max(1, chars.length - 1))}`;
}

/**
 * 選択肢が {value,label} で返るときに両方を取り出す。
 * coerceCustomerInfoDisplayString は value を label より優先して読むため、
 * 値がコード・ラベルが氏名という構成だと氏名突合が全滅する。その判定用。
 */
function valueAndLabel(
  raw: unknown,
): { value?: string; label?: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const value = typeof o.value === "string" ? o.value : undefined;
  const label = typeof o.label === "string" ? o.label : undefined;
  if (value === undefined && label === undefined) return null;
  return { value, label };
}

/** 数字を 9 に潰して「形」だけ見る（2026-08-01 → 9999-99-99） */
function shapeOf(s: string): string {
  return s.replace(/\d/g, "9");
}

/** 生の値の型だけを返す（中身は返さない） */
function rawTypeOf(raw: unknown): string {
  if (raw === null) return "null";
  if (raw === undefined) return "undefined";
  if (Array.isArray(raw)) return "array";
  return typeof raw;
}

export async function GET(request: Request) {
  // 無効時は存在しないルートと同じ見え方にする。認証より前に判定する
  if (process.env.PROBE_ENABLED?.trim() !== "1") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const boundStaffName = await resolveBoundStaffNameForLineUser(
    auth.lineUserId,
  );
  if (!boundStaffName) {
    return NextResponse.json(
      { error: "スタッフ名簿への紐付けが必要です", needsStaffBind: true },
      { status: 403 },
    );
  }

  const url = new URL(request.url);

  /**
   * ホーム画面の一時ボタンを出すかどうかの判定だけに使う。
   * @pocket は呼ばない（ボタンの表示可否のために毎回全件取得すると重い）。
   * ここまで来ている＝PROBE_ENABLED=1 かつ認証・紐付け済み。
   */
  if (url.searchParams.get("check") === "1") {
    return NextResponse.json({ enabled: true });
  }

  const appId = process.env.SALES_TARGET_APP_ID?.trim();
  if (!appId) {
    return NextResponse.json(
      { error: "SALES_TARGET_APP_ID が未設定です" },
      { status: 503 },
    );
  }

  const sampleParam = Number(url.searchParams.get("sample") ?? "5");
  const sampleSize = Number.isFinite(sampleParam)
    ? Math.min(20, Math.max(0, Math.floor(sampleParam)))
    : 5;

  let apiKey: string;
  try {
    apiKey = apiKeyForAppFields("SALES_TARGET");
  } catch {
    // 例外メッセージには環境変数「名」が入るが、値は入らない。
    // それでもレスポンスには載せず、定型文だけ返す
    return NextResponse.json(
      { error: "SALES_TARGET_ATPOCKET_API_KEY が未設定です" },
      { status: 503 },
    );
  }

  try {
    const fields = await fetchAppFields(
      appId,
      { apiKey },
      { operation: "probe:sales-target-fields", appEnv: "SALES_TARGET_APP_ID" },
    );

    // ── 1. 列の定義 ────────────────────────────────────
    const fieldList = fields
      .filter((f) => f.uniqueId?.trim())
      .map((f) => ({
        uniqueId: f.uniqueId?.trim() ?? "",
        caption: f.caption?.trim() ?? "",
        fieldType: f.fieldType?.trim() ?? "",
      }));

    const resolved: Record<
      TargetColumnKey,
      { caption: string; uniqueId: string | null; fieldType: string | null }
    > = {} as never;
    for (const [key, caption] of Object.entries(TARGET_CAPTIONS)) {
      const f = findFieldByCaption(fields, caption);
      resolved[key as TargetColumnKey] = {
        caption,
        uniqueId: f?.uniqueId?.trim() ?? null,
        fieldType: f?.fieldType?.trim() ?? null,
      };
    }
    const unresolvedCaptions = Object.entries(resolved)
      .filter(([, v]) => !v.uniqueId)
      .map(([, v]) => v.caption);

    // ── 2. レコード（参照のみ） ────────────────────────
    const list = await fetchRecordsList(
      appId,
      { limit: "1000", page: "1" },
      { apiKey },
      {
        operation: "probe:sales-target-records",
        appEnv: "SALES_TARGET_APP_ID",
      },
    );
    const records = (list.records ?? []).filter(
      (r) => r.record && typeof r.record === "object",
    );

    const readRaw = (
      recObj: Record<string, unknown>,
      key: TargetColumnKey,
    ): unknown => {
      const id = resolved[key].uniqueId;
      if (!id) return undefined;
      return pickRecordValueByFieldAliases(recObj, id);
    };

    // ── 3. 先頭数件の生の形 ────────────────────────────
    const sample = records.slice(0, sampleSize).map((row) => {
      const recObj = row.record as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(TARGET_CAPTIONS) as TargetColumnKey[]) {
        const raw = readRaw(recObj, key);
        if (key === "staffName") {
          const vl = valueAndLabel(raw);
          out[key] = {
            rawType: rawTypeOf(raw),
            // 氏名そのものは返さない
            valueMasked: vl?.value ? maskName(vl.value) : undefined,
            labelMasked: vl?.label ? maskName(vl.label) : undefined,
            displayMasked: maskName(coerceCustomerInfoDisplayString(raw)),
          };
          continue;
        }
        out[key] = { rawType: rawTypeOf(raw), raw };
      }
      return out;
    });

    // ── 4. 目標月の形式 ────────────────────────────────
    const monthShapes: Record<string, number> = {};
    const monthValues = new Set<string>();
    for (const row of records) {
      const recObj = row.record as Record<string, unknown>;
      const s = coerceCustomerInfoDisplayString(readRaw(recObj, "month"));
      const shape = s ? shapeOf(s) : "（空）";
      monthShapes[shape] = (monthShapes[shape] ?? 0) + 1;
      if (s) monthValues.add(s);
    }

    // ── 5. 担当者名の形（value / label のどちらが氏名か） ──
    let objectShaped = 0;
    let stringShaped = 0;
    let valueEqualsLabel = 0;
    let valueDiffersLabel = 0;
    let valueLooksNumeric = 0;
    let labelLooksNumeric = 0;
    /** 呼び出し元本人の氏名がどちらに一致するか。本人の情報なので伏せない */
    let selfMatchesValue = false;
    let selfMatchesLabel = false;
    let selfMatchesDisplay = false;
    const self = normApClStaffName(boundStaffName);

    for (const row of records) {
      const recObj = row.record as Record<string, unknown>;
      const raw = readRaw(recObj, "staffName");
      const vl = valueAndLabel(raw);
      if (vl) {
        objectShaped += 1;
        if (vl.value !== undefined && /^\d+$/.test(vl.value.trim())) {
          valueLooksNumeric += 1;
        }
        if (vl.label !== undefined && /^\d+$/.test(vl.label.trim())) {
          labelLooksNumeric += 1;
        }
        if (vl.value !== undefined && vl.label !== undefined) {
          if (vl.value === vl.label) valueEqualsLabel += 1;
          else valueDiffersLabel += 1;
        }
        if (vl.value && normApClStaffName(vl.value) === self) {
          selfMatchesValue = true;
        }
        if (vl.label && normApClStaffName(vl.label) === self) {
          selfMatchesLabel = true;
        }
      } else if (typeof raw === "string") {
        stringShaped += 1;
      }
      if (
        normApClStaffName(coerceCustomerInfoDisplayString(raw)) === self &&
        self
      ) {
        selfMatchesDisplay = true;
      }
    }

    // ── 6. 部署・支社の値と人数 ────────────────────────
    const groupSummary = (key: "department" | "branch") => {
      const rowCounts = new Map<string, number>();
      const members = new Map<string, Set<string>>();
      for (const row of records) {
        const recObj = row.record as Record<string, unknown>;
        const label =
          coerceCustomerInfoDisplayString(readRaw(recObj, key)) || "（空）";
        rowCounts.set(label, (rowCounts.get(label) ?? 0) + 1);
        const name = normApClStaffName(
          coerceCustomerInfoDisplayString(readRaw(recObj, "staffName")),
        );
        if (!name) continue;
        const set = members.get(label) ?? new Set<string>();
        set.add(name);
        members.set(label, set);
      }
      return [...rowCounts.entries()]
        .map(([label, rowCount]) => ({
          label,
          rowCount,
          // 人数だけ返す。氏名は返さない
          memberCount: members.get(label)?.size ?? 0,
        }))
        .sort((a, b) => b.rowCount - a.rowCount);
    };

    const distinctStaffCount = new Set(
      records
        .map((row) =>
          normApClStaffName(
            coerceCustomerInfoDisplayString(
              readRaw(row.record as Record<string, unknown>, "staffName"),
            ),
          ),
        )
        .filter(Boolean),
    ).size;

    return NextResponse.json({
      note: "一時的な調査用ルートです。確認後に削除し、PROBE_ENABLED を外してください",
      appId,
      fieldCount: fieldList.length,
      fields: fieldList,
      resolvedColumns: resolved,
      unresolvedCaptions,
      recordCount: records.length,
      distinctStaffCount,
      sample,
      month: {
        shapes: monthShapes,
        distinctValues: [...monthValues].sort(),
      },
      staffNameShape: {
        fieldType: resolved.staffName.fieldType,
        objectShaped,
        stringShaped,
        valueEqualsLabel,
        valueDiffersLabel,
        valueLooksNumeric,
        labelLooksNumeric,
        // 呼び出し元本人の氏名がどこに一致したか（本人の情報のみ）
        selfMatchesValue,
        selfMatchesLabel,
        selfMatchesDisplay,
      },
      department: groupSummary("department"),
      branch: groupSummary("branch"),
    });
  } catch (e) {
    // @pocket のエラー本文には環境変数名などが混ざるため、レスポンスには載せない
    console.error("[api/_probe/sales-target]", e);
    return NextResponse.json(
      {
        error:
          "目標登録アプリの調査に失敗しました。詳細はサーバログを確認してください。",
      },
      { status: 502 },
    );
  }
}
