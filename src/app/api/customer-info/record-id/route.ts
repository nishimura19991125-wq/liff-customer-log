import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";
import { fetchAppFields } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import {
  customerInfoConfigReady,
  customerInfoImportKeyFieldId,
  customerInfoPocketAuth1,
} from "@/lib/customer-info-config";
import { findCustomerInfoRecordIdByUniqueKeyCached } from "@/lib/customer-info-key-lookup-cache";
import { consumeRateLimit } from "@/lib/simple-rate-limit";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

/**
 * T番号 → お客様情報アプリのレコードID。
 *
 * 工事カレンダーの案件カードから契約情報入力フォームへ飛ぶための変換。
 * 工事アプリとお客様情報アプリはレコードIDが別なので、両アプリが持つ
 * T番号で突き合わせる。手順は customer-info-construction-handler.ts
 * （工事対応者の連携）と同じにそろえてある。
 *
 * ■ 値をクエリに直接埋めない
 * 照合そのものは findCustomerInfoRecordIdByUniqueKeyCached に任せる。
 * あちらが `field-N = "値"` のフィールド式を escapePocketQueryValue 付きで
 * 組み立てる。**ここで query を組み立て直さないこと。**
 * 以前 query に値そのものを渡して全件走査になった経緯がある
 * （customer-info-key-lookup.ts の「フィールド式で絞る」を参照）。
 *
 * ■ 応答は固定文言だけ
 * 見つからない理由（列が解決できない・未設定など）を画面へ書き分けない。
 * @pocket 側の構造が外へ出るため、例外は pocketErrorResponse に通す。
 */

/** T番号の長さ上限（実際は10文字程度。桁外れの入力を照合へ回さない） */
const T_NUMBER_MAX_LENGTH = 64;
/** 同一ユーザーからの変換頻度（検索 API と同じ枠） */
const LOOKUP_RATE_WINDOW_MS = 10_000;
const LOOKUP_RATE_MAX = 5;

const NOT_FOUND_MESSAGE = "該当するお客様情報が見つかりません";
const EMPTY_T_NUMBER_MESSAGE = "T番号を指定してください";
const INVALID_T_NUMBER_MESSAGE = "T番号の形式が正しくありません";
const NOT_CONFIGURED_MESSAGE =
  "お客様情報との連携が設定されていません。管理者にお問い合わせください。";

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const cfg = customerInfoConfigReady();
  if (!cfg.ok) {
    return NextResponse.json(
      { error: cfg.error, disabled: true },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const tNumber = url.searchParams.get("tNumber")?.trim() ?? "";
  if (!tNumber) {
    return NextResponse.json(
      { error: EMPTY_T_NUMBER_MESSAGE },
      { status: 400 },
    );
  }
  if (Array.from(tNumber).length > T_NUMBER_MAX_LENGTH) {
    return NextResponse.json(
      { error: INVALID_T_NUMBER_MESSAGE },
      { status: 400 },
    );
  }

  if (
    !consumeRateLimit(`customer-info-record-id:${auth.lineUserId}`, {
      windowMs: LOOKUP_RATE_WINDOW_MS,
      max: LOOKUP_RATE_MAX,
    })
  ) {
    return NextResponse.json(
      {
        error:
          "続けて操作されています。少し待ってから再度お試しください。",
      },
      { status: 429 },
    );
  }

  const importKeyEnv = customerInfoImportKeyFieldId();
  if (!importKeyEnv) {
    return NextResponse.json(
      { error: NOT_CONFIGURED_MESSAGE, disabled: true },
      { status: 503 },
    );
  }

  try {
    const readAuth = customerInfoPocketAuth1();
    const appFields = await fetchAppFields(cfg.appId, readAuth, {
      operation: "customer-info:T番号からレコードID(列定義)",
      appEnv: "CUSTOMER_INFO_APP_ID",
    });

    const keyFieldId = resolveConfiguredFieldToSchemaUniqueId(
      importKeyEnv,
      appFields,
    );
    if (!keyFieldId) {
      // 設定漏れ。画面には理由を出さず、気づけるようログには残す
      console.error(
        "[api/customer-info/record-id] 取込キー（T番号）の列がお客様情報アプリの列定義と一致しません。" +
          "CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID を確認してください",
      );
      return NextResponse.json(
        { error: NOT_CONFIGURED_MESSAGE, disabled: true },
        { status: 503 },
      );
    }

    const recordId = await findCustomerInfoRecordIdByUniqueKeyCached(
      keyFieldId,
      tNumber,
    );
    if (!recordId) {
      return NextResponse.json(
        { error: NOT_FOUND_MESSAGE },
        { status: 404 },
      );
    }

    return NextResponse.json({ recordId });
  } catch (e) {
    return pocketErrorResponse(e, {
      scope: "api/customer-info/record-id",
      message: "お客様情報を確認できませんでした",
    });
  }
}
