import { NextResponse } from "next/server";

import {
  isDisplayableImageFile,
  isImageMimeType,
  parseAtPocketFileField,
  type AtPocketFileEntry,
} from "@/lib/at-pocket-file-field";
import {
  apiKeyForStaffPocketReadApClList,
  atPocketAbsoluteUrl,
} from "@/lib/atpocket";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import {
  getOrLoadStaffPhoto,
  type StaffPhotoPayload,
} from "@/lib/staff-photo-cache";
import {
  fetchStaffPhotoRawValue,
  findStaffRecordIdByName,
  resolveStaffPhotoLookupConfig,
} from "@/lib/staff-photo-lookup";

export const dynamic = "force-dynamic";

/**
 * スタッフ名簿の顔写真を返す（営業ダッシュボードの上位3人用）。
 *
 * ■ 受け取るのは担当者名だけ
 * recordId・fieldId・appId・URL は**一切受け取らない**。任意のIDを渡せる
 * 作りにすると、名簿以外のアプリの添付まで読み出せる中継口になる。
 * アプリIDと列IDはサーバ側で固定し、名前から名簿キャッシュを引く。
 *
 * ■ 名簿は共有キャッシュ、写真は1件ずつ
 * 名前から recordId を引くところまでは名簿の共有キャッシュ。写真列は
 * 名簿の取得列に含めていない（base64 で返る仕様だと名簿を共有する
 * 全画面が重くなるため）。写真はその1件だけを取り直す。
 * 上位3人ぶんで最大3回、結果は30分キャッシュするので往復は増えない。
 *
 * ■ 返すのは画像だけ
 * Content-Type が image/ で始まらないものは返さない。上限も設ける。
 */

/** 中継してよい最大サイズ。顔写真としては十分で、転送量の歯止めになる */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** ブラウザ側の保持。名簿の更新が長く残らない程度に短くする */
const BROWSER_CACHE_SECONDS = 300;

function notFound(): NextResponse {
  // @pocket の情報（appsId・列・キー）は載せない
  return NextResponse.json({ error: "写真が見つかりません" }, { status: 404 });
}

function tooLarge(name: string, size: number): null {
  console.warn(
    "[api/staff/photo] 写真が上限を超えたため返しません",
    JSON.stringify({ bytes: size, limit: MAX_PHOTO_BYTES, name }),
  );
  return null;
}

async function loadFromExternalUrl(
  url: string,
): Promise<StaffPhotoPayload | null> {
  const absolute = atPocketAbsoluteUrl(url);
  if (!absolute) return null;

  let res: Response;
  try {
    res = await fetch(absolute, {
      headers: {
        "X-At-Pocket-API-Key": apiKeyForStaffPocketReadApClList(),
        Accept: "image/*",
      },
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const mimeType =
    res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  // 画像以外は中継しない（HTML のログイン画面などをそのまま返さない）
  if (!isImageMimeType(mimeType)) {
    console.warn(
      "[api/staff/photo] 画像以外が返ったため中継しません",
      JSON.stringify({ mimeType }),
    );
    return null;
  }

  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_PHOTO_BYTES) {
    return tooLarge("(content-length)", declared);
  }

  const body = Buffer.from(await res.arrayBuffer());
  if (body.byteLength > MAX_PHOTO_BYTES) {
    return tooLarge("(body)", body.byteLength);
  }
  return { body, mimeType };
}

function loadFromBase64(file: AtPocketFileEntry): StaffPhotoPayload | null {
  const raw = file.contentBase64?.trim();
  if (!raw) return null;
  const mimeType = file.mimeType?.trim() || "image/jpeg";
  if (!isImageMimeType(mimeType)) return null;

  const body = Buffer.from(raw, "base64");
  if (body.byteLength === 0) return null;
  if (body.byteLength > MAX_PHOTO_BYTES) {
    return tooLarge(file.name, body.byteLength);
  }
  return { body, mimeType };
}

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const url = new URL(request.url);
  const staffName = normApClStaffName(
    url.searchParams.get("staffName") ?? "",
  );
  if (!staffName) {
    return NextResponse.json(
      { error: "クエリ staffName を指定してください" },
      { status: 400 },
    );
  }

  try {
    const cfg = await resolveStaffPhotoLookupConfig();
    // 列が無い＝写真機能そのものが無効。エラーにはしない
    if (!cfg) return notFound();

    const photo = await getOrLoadStaffPhoto(staffName, async () => {
      // 名前 → recordId は名簿キャッシュから。写真だけ1件取り直す
      const recordId = await findStaffRecordIdByName(staffName, cfg);
      if (!recordId) return null;

      const raw = await fetchStaffPhotoRawValue(recordId, cfg);
      if (raw == null) return null;

      const files = parseAtPocketFileField(raw).filter(
        (f) =>
          isDisplayableImageFile(f) &&
          (f.contentBase64?.trim() || f.externalUrl?.trim()),
      );
      const file = files[0];
      if (!file) return null;

      const fromBase64 = loadFromBase64(file);
      if (fromBase64) return fromBase64;

      const external = file.externalUrl?.trim();
      return external ? await loadFromExternalUrl(external) : null;
    });

    if (!photo) return notFound();

    return new NextResponse(new Uint8Array(photo.body), {
      headers: {
        "Content-Type": photo.mimeType,
        "Cache-Control": `private, max-age=${BROWSER_CACHE_SECONDS}`,
      },
    });
  } catch (e) {
    // 生メッセージには appsId・列・環境変数名が載る。ログにだけ残す
    console.error(
      "[api/staff/photo]",
      e instanceof Error ? e.message : String(e),
    );
    return NextResponse.json(
      { error: "写真を取得できませんでした" },
      { status: 502 },
    );
  }
}
