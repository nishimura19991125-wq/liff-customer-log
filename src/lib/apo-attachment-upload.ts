import "server-only";

import {
  apiKeyForSalesDashboardApoPocket,
  apiKeyForSalesDashboardApoWrite,
  fetchAppFields,
  fetchRecordById,
  updateRecord,
} from "@/lib/atpocket";
import {
  coerceCustomerInfoDisplayString,
  customerInfoPutValue,
  readCustomerInfoFieldValue,
  readCustomerInfoImportKeyFromRecord,
} from "@/lib/customer-info-record";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import {
  dropboxApoConfigured,
  dropboxApoRootPath,
  dropboxSharedLinkForPath,
  ensureDropboxFolderAtPath,
  listCustomerFolderFileNames,
  uploadDropboxFile,
} from "@/lib/dropbox";
import {
  buildDocumentFileName,
  documentFileNamePrefix,
  jstFileNameStamp,
  nextDocumentSequence,
} from "@/lib/document-upload-name";
import {
  APO_ATTACHMENT_CAPTION,
  buildApoAttachmentPaths,
} from "@/lib/apo-attachment";
import { resolveApoAcquisitionFields } from "@/lib/apo-acquisition-fields";
import {
  meetingScheduleImportKeySourceFieldIds,
  resolveMeetingScheduleFieldMap,
  resolveMeetingScheduleImportKeyFieldId,
} from "@/lib/meeting-schedule-fields";
import { recordMatchesStaff } from "@/lib/meeting-schedule";
import { salesDashboardApoAppId } from "@/lib/sales-dashboard-fields";

/**
 * アポ資料（立面図・平面図）を1件 Dropbox へ置き、
 * フォルダの共有リンクを @pocket に保存する。
 *
 * ■ 置き場所
 *   {DROPBOX_APO_ROOT_PATH}/{年}年商談資料一式/{アポ通番}_{顧客名}様/
 * 年はアポ取得日基準。年フォルダが無ければ作る。
 *
 * ■ 取り消せない
 * Dropbox に削除権限が無いので、上げたファイルは取り消せない。
 * ファイル名に日時と連番を入れて衝突を避け、再送は別ファイルとして残す
 * （上書きしない）。
 *
 * ■ 共有リンク
 * 公開範囲の検証は顧客フォルダと同じ経路（audience=team の明示と
 * resolved_visibility の検証）を通る。確認できないリンクは採用しない。
 */

/** ドロップボックスURL の列。見出しが分からないので識別名で引く */
const DROPBOX_LINK_FIELD = {
  envKey: "APO_ACQUISITION_DROPBOX_LINK_FIELD_ID",
  fallbackFieldId: "field-59",
} as const;

export type StoreApoAttachmentResult =
  | { ok: true; fileName: string; linkSaved: boolean }
  | { ok: false; status: number; error: string };

export type ApoAttachmentFailure = { ok: false; status: number; error: string };

type ApoAttachmentContext = {
  ok: true;
  apoAppId: string;
  apoFields: Awaited<ReturnType<typeof fetchAppFields>>;
  paths: NonNullable<ReturnType<typeof buildApoAttachmentPaths>>;
  customerName: string;
  /** アポ通番。更新時に同送が要るのでここで持ち回る */
  importKey: { fieldId: string; value: string } | null;
};

/**
 * 保存先フォルダを決めるところまで。
 * ファイルの追加とリンクの貼り直しの両方から通る
 */
async function resolveApoAttachmentContext(opts: {
  recordId: string;
  boundStaffName: string;
}): Promise<ApoAttachmentContext | ApoAttachmentFailure> {
  if (!dropboxApoConfigured()) {
    return {
      ok: false,
      status: 503,
      error:
        "アポ資料の保存先が未設定のため、添付できません。管理者にご連絡ください。",
    };
  }
  const rootPath = dropboxApoRootPath();
  if (!rootPath) {
    return { ok: false, status: 503, error: "アポ資料の保存先が未設定です" };
  }

  const apoAppId = salesDashboardApoAppId();
  if (!apoAppId) {
    return { ok: false, status: 503, error: "アポ取得情報の設定が未完了です" };
  }

  const readAuth = { apiKey: apiKeyForSalesDashboardApoPocket() };
  const apoFields = await fetchAppFields(apoAppId, readAuth, {
    operation: "apo-attachment:fields",
    appEnv: "SALES_DASHBOARD_APO_APP_ID",
  });

  const fieldMap = resolveMeetingScheduleFieldMap(apoFields);
  if (!fieldMap) {
    return { ok: false, status: 503, error: "アポ取得情報の列を特定できません" };
  }

  const row = await fetchRecordById(apoAppId, opts.recordId, readAuth);
  if (!row?.record || typeof row.record !== "object") {
    return { ok: false, status: 404, error: "案件が見つかりません" };
  }
  const recObj = row.record as Record<string, unknown>;

  // 一覧・詳細と同じ担当者の制限。他人の案件へは添付できない
  if (!recordMatchesStaff(recObj, fieldMap, opts.boundStaffName)) {
    return { ok: false, status: 403, error: "この案件には添付できません" };
  }

  const read = (fieldId: string | null): string =>
    fieldId
      ? coerceCustomerInfoDisplayString(
          readCustomerInfoFieldValue(recObj, fieldId),
        ).trim()
      : "";

  const customerName = read(fieldMap.customerName);

  const importKeyFieldId = resolveMeetingScheduleImportKeyFieldId(apoFields);
  const apoNumber = importKeyFieldId
    ? readCustomerInfoImportKeyFromRecord(
        recObj,
        importKeyFieldId,
        meetingScheduleImportKeySourceFieldIds(),
      ).trim()
    : "";

  /**
   * 年はアポ取得日を基準にする。
   * 列の特定は登録時と同じ resolveApoAcquisitionFields を通す
   * （環境変数と見出しの両方を見るので、片方だけの実装だと食い違う）
   */
  const apoAcquiredDate = read(
    resolveApoAcquisitionFields(apoFields).apoAcquiredDate.uniqueId,
  );

  const paths = buildApoAttachmentPaths({
    rootPath,
    apoAcquiredDate: apoAcquiredDate || read(fieldMap.scheduledDate),
    apoNumber,
    customerName,
  });
  if (!paths) {
    // ログにフルパスは出さない。何が欠けたかだけ残す
    console.error("[apo-attachment] 保存先を組み立てられません", {
      recordId: opts.recordId,
      hasApoNumber: Boolean(apoNumber),
      hasCustomerName: Boolean(customerName),
      hasApoAcquiredDate: Boolean(apoAcquiredDate),
    });
    return {
      ok: false,
      status: 400,
      error:
        "保存先を決められませんでした（アポ通番・お客様名・アポ取得日のいずれかが未設定です）。",
    };
  }

  return {
    ok: true,
    apoAppId,
    apoFields,
    paths,
    customerName,
    importKey:
      importKeyFieldId && apoNumber
        ? { fieldId: importKeyFieldId, value: apoNumber }
        : null,
  };
}

export async function storeApoAttachmentFile(opts: {
  recordId: string;
  boundStaffName: string;
  /** 検証済みの拡張子 */
  extension: string;
  bytes: Uint8Array;
  now?: Date;
}): Promise<StoreApoAttachmentResult> {
  const ctx = await resolveApoAttachmentContext(opts);
  if (!ctx.ok) return ctx;
  const { paths, customerName } = ctx;

  // 年フォルダ → アポフォルダの順に用意する
  await ensureDropboxFolderAtPath(paths.yearPath);
  await ensureDropboxFolderAtPath(paths.folderPath);

  // ── ファイル名の組み立て。お客様情報の書類と同じ規則 ──────────
  const stamp = jstFileNameStamp(opts.now ?? new Date());
  const prefix = documentFileNamePrefix({
    caption: APO_ATTACHMENT_CAPTION,
    customerName,
    ymd: stamp.ymd,
    hm: stamp.hm,
  });
  if (!prefix) {
    return {
      ok: false,
      status: 400,
      error: "ファイル名を組み立てられませんでした（お客様名が未設定です）。",
    };
  }

  const existing = await listCustomerFolderFileNames(paths.folderPath);
  const seq = nextDocumentSequence(existing, prefix);
  const fileName = buildDocumentFileName(prefix, seq, opts.extension);

  await uploadDropboxFile(`${paths.folderPath}/${fileName}`, opts.bytes);

  /**
   * ここから先が失敗しても、ファイルは既に Dropbox にある。
   * 添付そのものは成功として返し、リンクの保存だけ失敗したと伝える
   */
  let linkSaved = false;
  try {
    const url = await dropboxSharedLinkForPath(paths.folderPath);
    linkSaved = await saveDropboxLink(ctx, opts.recordId, url);
  } catch (e) {
    console.error(
      "[apo-attachment] 共有リンクの保存に失敗しました",
      messageForLog(e),
    );
  }

  return { ok: true, fileName, linkSaved };
}

/**
 * 共有リンクだけを貼り直す。
 *
 * ファイルは上がったのにリンクの保存だけ落ちた場合の受け皿。
 * 手作業でやり直すには @pocket を直接触るしかなくなるので、
 * 画面から押し直せる経路を残しておく。
 *
 * フォルダを新しく作りはしない（既に無いなら貼るリンクも無い）。
 */
export async function saveApoAttachmentSharedLink(opts: {
  recordId: string;
  boundStaffName: string;
}): Promise<{ ok: true } | ApoAttachmentFailure> {
  const ctx = await resolveApoAttachmentContext(opts);
  if (!ctx.ok) return ctx;

  const url = await dropboxSharedLinkForPath(ctx.paths.folderPath);
  const saved = await saveDropboxLink(ctx, opts.recordId, url);
  if (!saved) {
    return {
      ok: false,
      status: 502,
      error: "共有リンクを保存できませんでした",
    };
  }
  return { ok: true };
}

/**
 * ログに残してよい形にする。
 *
 * 例外の文面には Dropbox のフルパスや URL が混ざることがある。
 * 親階層の構造を残さない方針（dropbox.ts の folderNameForLog と同じ）に
 * 合わせ、パスらしき並びは伏せる。
 */
function messageForLog(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/\/[^\s"']*/g, "…");
}

/**
 * 共有リンクを @pocket の「ドロップボックスURL」へ保存する。
 *
 * 取込キーの同送が要る（更新時の作法）。失敗しても例外にせず false を返し、
 * 呼び出し側が画面へ伝える。
 */
async function saveDropboxLink(
  ctx: ApoAttachmentContext,
  recordId: string,
  url: string,
): Promise<boolean> {
  if (!url.trim()) return false;

  const env = process.env[DROPBOX_LINK_FIELD.envKey]?.trim();
  const linkFieldId =
    (env ? resolveConfiguredFieldToSchemaUniqueId(env, ctx.apoFields) : null) ??
    resolveConfiguredFieldToSchemaUniqueId(
      DROPBOX_LINK_FIELD.fallbackFieldId,
      ctx.apoFields,
    );
  if (!linkFieldId) {
    console.error("[apo-attachment] ドロップボックスURL列を特定できません");
    return false;
  }

  // 取込キーは保存先を決めるときに読んだものを使い回す（@pocket を再度叩かない）
  if (!ctx.importKey) {
    console.error("[apo-attachment] 取込キーを特定できません");
    return false;
  }

  await updateRecord(
    ctx.apoAppId,
    recordId,
    {
      [ctx.importKey.fieldId]: ctx.importKey.value,
      [linkFieldId]: customerInfoPutValue(url),
    },
    { apiKey: apiKeyForSalesDashboardApoWrite() },
  );
  return true;
}
