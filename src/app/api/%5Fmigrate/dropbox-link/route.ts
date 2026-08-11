import { NextResponse } from "next/server";

/**
 * 【一時的な移行用ルート】
 *
 * 既存顧客の Dropboxリンク 列を、書類移行で作られた Dropbox フォルダで
 * 一括で埋めます（タスクN）。
 * **移行完了後に削除してください。**
 * MIGRATE_ENABLED が未設定なら 404 を返します。
 *
 * フォルダ名が `%5Fmigrate` なのは Next.js の仕様によるものです。
 * `_` 始まりのフォルダは private folder としてルーティングから除外されるため、
 * URL に `_` を出すには `%5F`（アンダースコアの URL エンコード）を使います。
 * 実際のパスは /api/_migrate/dropbox-link になります。
 *
 * 呼び出し方:
 *   POST /api/_migrate/dropbox-link                 ドライラン（既定・書き込まない）
 *   POST /api/_migrate/dropbox-link?dryRun=0        実際に書き込む
 *   POST /api/_migrate/dropbox-link?dryRun=0&limit=50&delayMs=200
 *   POST /api/_migrate/dropbox-link?check=1         有効かどうかだけ返す
 *
 * 安全策:
 *   - MIGRATE_ENABLED=1 のときだけ動作する。未設定なら 404（存在しない
 *     ルートと区別が付かないよう、認証より前に判定する）
 *   - LINE 認証必須（未認証は 401）。スタッフ名簿への紐付け必須（無ければ 403）
 *   - **ドライランが既定**。?dryRun=0 を明示しない限り書き込まない
 *   - 1回で処理する件数に上限（既定50件・最大200件）
 *   - レコードごとに待機（既定200ms）。429 はリトライせず中断して報告
 *   - Dropbox / @pocket のエラー本文はレスポンスに載せない
 *   - 触るのは Dropboxリンク 列だけ（取込キーは更新に必須のため同値で同送）
 */

import {
  DROPBOX_LINK_MIGRATION_DEFAULT_DELAY_MS,
  DROPBOX_LINK_MIGRATION_DEFAULT_LIMIT,
  runDropboxLinkMigration,
} from "@/lib/dropbox-link-migration";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

/** 1回のリクエストで処理する件数の上限。全件を一度に流さない */
const MAX_LIMIT = 200;
const MAX_DELAY_MS = 5000;

function readIntParam(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export async function POST(request: Request) {
  // 無効時は存在しないルートと同じ見え方にする。認証より前に判定する
  if (process.env.MIGRATE_ENABLED?.trim() !== "1") {
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

  // 一時パネルの表示可否だけに使う。@pocket も Dropbox も呼ばない
  if (url.searchParams.get("check") === "1") {
    return NextResponse.json({ enabled: true });
  }

  // **既定はドライラン。** dryRun=0 と明示したときだけ書き込む
  const dryRun = url.searchParams.get("dryRun") !== "0";
  const limit = readIntParam(
    url.searchParams.get("limit"),
    DROPBOX_LINK_MIGRATION_DEFAULT_LIMIT,
    1,
    MAX_LIMIT,
  );
  const delayMs = readIntParam(
    url.searchParams.get("delayMs"),
    DROPBOX_LINK_MIGRATION_DEFAULT_DELAY_MS,
    0,
    MAX_DELAY_MS,
  );

  try {
    const outcome = await runDropboxLinkMigration({
      dryRun,
      limit,
      delayMs,
      lineUserId: auth.lineUserId,
    });
    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.error },
        { status: outcome.status },
      );
    }
    return NextResponse.json({
      note: "一時的な移行用ルートです。完了後に削除し、MIGRATE_ENABLED を外してください",
      executedBy: boundStaffName,
      ...outcome.result,
    });
  } catch (e) {
    // @pocket / Dropbox の生の本文には環境変数名やパスが混ざるため載せない
    console.error("[api/_migrate/dropbox-link]", e);
    return NextResponse.json(
      {
        error:
          "移行処理に失敗しました。詳細はサーバログを確認してください。",
      },
      { status: 502 },
    );
  }
}
