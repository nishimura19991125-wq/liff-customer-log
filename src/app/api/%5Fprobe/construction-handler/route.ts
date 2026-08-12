import { NextResponse } from "next/server";

/**
 * 【一時的な調査用ルート】
 *
 * 工事対応者の書き込みが @pocket に反映されない件の原因究明用です。
 * **原因が判明したら削除してください。**
 * PROBE_ENABLED が未設定なら 404 を返します。
 *
 * フォルダ名が `%5Fprobe` なのは Next.js の仕様によるものです。
 * `_` 始まりのフォルダは private folder としてルーティングから除外されるため、
 * URL に `_` を出すには `%5F` を使います。
 * 実際のパスは /api/_probe/construction-handler になります。
 *
 * ── 呼び出し方 ────────────────────────────────────────────
 *   POST /api/_probe/construction-handler
 *   { "recordId": "3228" }                     調べるだけ（書き込まない）
 *   { "recordId": "3228", "value": "…", "write": true }   実際に PUT する
 *
 * ── 返すもの ──────────────────────────────────────────────
 *   - 解決した工事対応者列の uniqueId と fieldType
 *   - 対象レコードの現在の全フィールド（工事対応者の周辺を見るため）
 *   - write:true のとき、送った payload と **@pocket の応答本文そのまま**
 *   - 書き込み後に読み直した値
 *
 * ⚠ 応答には工事レコードの全項目（顧客名など）が入ります。**このルートに
 *   限り**、原因究明のため @pocket の応答本文もそのまま返します。
 *   貼り付けて共有するときは中身を確認してください。
 *   API キーなどの秘密情報は出力しません。
 *
 * ── 安全策 ────────────────────────────────────────────────
 *   - PROBE_ENABLED=1 のときだけ動作。未設定なら 404（存在しないルートと
 *     区別が付かないよう、認証より前に判定する）
 *   - LINE 認証必須（401）。スタッフ名簿への紐付け必須（403）
 *   - **書き込みは recordId と value を明示し、write:true を付けたときだけ**。
 *     既定は調べるだけ
 *   - 触るのは T番号（取込キー）と工事対応者の2列のみ。本番の
 *     update-construction-handler と同じ payload を送る
 */

import {
  apiKeyForCalendarPocket1,
  apiKeyForCalendarWrite,
  fetchAppFields,
  fetchRecordById,
  type AtPocketFieldRow,
} from "@/lib/atpocket";
import { calendarConstructionHandlerFieldIdFromEnv } from "@/lib/calendar-construction-handler-env";
import { readConstructionTNumberFromRecord } from "@/lib/calendar-construction-pocket-common";
import {
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionTNumberFieldId,
} from "@/lib/calendar-kojo";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

/** 応答本文が巨大でも返しきれるように上限を設ける */
const RAW_BODY_LIMIT = 4000;

type Body = {
  recordId?: string;
  value?: string;
  write?: boolean;
};

/**
 * @pocket の PUT を **updateRecord と同じ形**で送り、応答本文も返す。
 *
 * src/lib/atpocket.ts の updateRecord（`export async function updateRecord`）を
 * そのまま写している。違いは成功時にも本文を捨てない点だけ。
 * 本番の updateRecord は成功時の本文を読み捨てるため、200 でありながら列が
 * 無視されている場合に何も分からない。ここを見るのが今回の目的。
 *
 * 共通化せず写しているのは、このルートが一時的なもので、削除時に本番の
 * コードへ痕跡を残さないようにするため。
 */
async function putRecordWithRawResponse(
  appsId: string,
  recordId: string,
  record: Record<string, unknown>,
  apiKey: string,
): Promise<{ status: number; ok: boolean; body: string; url: string }> {
  const domain = process.env.ATPOCKET_DOMAIN?.trim();
  if (!domain) throw new Error("ATPOCKET_DOMAIN is not set");
  const normalized = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const authHeader =
    process.env.ATPOCKET_AUTH_HEADER?.trim() || "X-At-Pocket-API-Key";

  const url = `https://${normalized}/api/apps/${appsId}/records/${encodeURIComponent(recordId)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      [authHeader]: apiKey,
    },
    body: JSON.stringify({ record }),
  });
  const text = await res.text();
  return {
    status: res.status,
    ok: res.ok,
    body: text.slice(0, RAW_BODY_LIMIT),
    // ドメインは秘密ではないが、パスの形だけ分かれば十分なのでホストは伏せる
    url: url.replace(`https://${normalized}`, "(host)"),
  };
}

function fieldInfo(
  fields: AtPocketFieldRow[],
  uniqueId: string | null,
): { uniqueId: string | null; caption: string | null; fieldType: string | null } {
  if (!uniqueId) return { uniqueId: null, caption: null, fieldType: null };
  const f = fields.find((x) => x.uniqueId?.trim() === uniqueId.trim());
  return {
    uniqueId,
    caption: f?.caption?.trim() ?? null,
    fieldType: f?.fieldType?.trim() ?? null,
  };
}

export async function POST(request: Request) {
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

  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (!calAppId) {
    return NextResponse.json(
      { error: "CALENDAR_APP_ID が未設定です" },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // 書き込みを伴うため、対象レコードは必ず明示させる
  const recordId = body.recordId?.trim() ?? "";
  if (!recordId) {
    return NextResponse.json(
      { error: "recordId が必要です（調べる対象を明示してください）" },
      { status: 400 },
    );
  }
  const write = body.write === true;
  const value = body.value?.trim() ?? "";
  if (write && !value) {
    return NextResponse.json(
      { error: "write:true のときは value（工事対応者名）が必要です" },
      { status: 400 },
    );
  }

  try {
    const readAuth = { apiKey: apiKeyForCalendarPocket1() };
    const constructionFields = await fetchAppFields(calAppId, readAuth);

    const handlerFieldEnv = calendarConstructionHandlerFieldIdFromEnv();
    const resolvedHandlerField = handlerFieldEnv
      ? resolveConfiguredFieldToSchemaUniqueId(
          handlerFieldEnv,
          constructionFields,
        )
      : null;
    const resolvedTNumber = resolveConstructionTNumberFieldId(constructionFields);

    // 全フィールドを取る（fields 指定なし）
    const beforeRow = await fetchRecordById(calAppId, recordId, readAuth);
    const beforeRec =
      beforeRow?.record && typeof beforeRow.record === "object"
        ? (beforeRow.record as Record<string, unknown>)
        : null;
    if (!beforeRec) {
      return NextResponse.json(
        { error: "レコードが見つかりません" },
        { status: 404 },
      );
    }

    const existingT = resolvedTNumber
      ? readConstructionTNumberFromRecord(beforeRec, resolvedTNumber)
      : null;

    const inspect = {
      note: "一時的な調査用ルートです。原因が判明したら削除し、PROBE_ENABLED を外してください",
      appId: calAppId,
      recordId,
      executedBy: boundStaffName,
      // 環境変数の「名前」と、そこから解決した uniqueId。キーの値は出さない
      handlerFieldEnvValue: handlerFieldEnv || null,
      handlerField: fieldInfo(constructionFields, resolvedHandlerField),
      tNumberField: fieldInfo(constructionFields, resolvedTNumber),
      existingTNumber: existingT,
      handlerValueBefore: resolvedHandlerField
        ? readCustomerInfoFieldValue(beforeRec, resolvedHandlerField)
        : null,
      // 工事対応者の周辺を見るため。⚠ 顧客名などが含まれる
      recordBefore: beforeRec,
      fieldCount: constructionFields.length,
    };

    if (!write) {
      return NextResponse.json({ ...inspect, wrote: false });
    }

    if (!resolvedHandlerField || !resolvedTNumber || !existingT) {
      return NextResponse.json(
        {
          ...inspect,
          wrote: false,
          error:
            "工事対応者列・T番号列・T番号の値のいずれかを解決できないため書き込みませんでした",
        },
        { status: 409 },
      );
    }

    // 本番の update-construction-handler と同じ payload
    const payload = {
      [resolvedTNumber]: existingT,
      [resolvedHandlerField]: value,
    };

    const put = await putRecordWithRawResponse(
      calAppId,
      recordId,
      payload,
      apiKeyForCalendarWrite(),
    );

    // 書き込み後に読み直す
    const afterRow = await fetchRecordById(calAppId, recordId, readAuth);
    const afterRec =
      afterRow?.record && typeof afterRow.record === "object"
        ? (afterRow.record as Record<string, unknown>)
        : null;
    const handlerValueAfter = afterRec
      ? readCustomerInfoFieldValue(afterRec, resolvedHandlerField)
      : null;

    return NextResponse.json({
      ...inspect,
      wrote: true,
      payloadSent: payload,
      putResponse: put,
      handlerValueAfter,
      reflected: handlerValueAfter === value,
      recordAfter: afterRec,
    });
  } catch (e) {
    console.error("[api/_probe/construction-handler]", e);
    return NextResponse.json(
      {
        // このルートは原因究明が目的なので、例外の内容も返す。
        // API キーは含まれない（formatPocketHttpError は環境変数名までしか出さない）
        error: e instanceof Error ? e.message.slice(0, RAW_BODY_LIMIT) : String(e),
      },
      { status: 502 },
    );
  }
}
