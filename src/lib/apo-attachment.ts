import {
  sanitizeCustomerNameForDropbox,
  sanitizeDropboxName,
} from "@/lib/dropbox-folder-name";

/**
 * アポ資料（立面図・平面図）の保存先の組み立て。
 *
 * 置き場所は顧客フォルダとは別で、次の形になる。
 *   {DROPBOX_APO_ROOT_PATH}/{年}年商談資料一式/{アポ通番}_{顧客名}様/
 *
 * 年は**アポ取得日**を基準にする。登録した日ではない（年またぎで
 * 登録が遅れた案件が、実際の取得年と違う棚に入るのを避けるため）。
 */

/** 添付欄の項目名。ファイル名の先頭に入る */
export const APO_ATTACHMENT_CAPTION = "立面図・平面図";

/** 1ファイルの上限。お客様情報の書類アップロードと同じ扱い */
export const APO_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

/** 1回の登録で添付できる件数 */
export const APO_ATTACHMENT_MAX_FILES = 5;

/**
 * 年フォルダの名前。
 * アポ取得日（YYYY-MM-DD / YYYY/MM/DD など）から年を取る。
 * 年を読めなければ null（推測で今年にしない）。
 */
export function apoAttachmentYearFolderName(
  apoAcquiredDate: string | undefined,
): string | null {
  const raw = (apoAcquiredDate ?? "").trim();
  const m = /^(\d{4})/.exec(raw.replace(/[^\d]/g, "").slice(0, 8));
  if (!m) return null;
  const year = Number(m[1]);
  // 桁数だけ合っていても年として不自然な値は弾く
  if (!Number.isFinite(year) || year < 2000 || year > 2999) return null;
  return `${year}年商談資料一式`;
}

/**
 * アポフォルダの名前。`{アポ通番}_{顧客名}様`
 *
 * 顧客名は姓名の区切りを全角スペースに揃える（既存のフォルダ名規則と同じ）。
 * どちらかが空なら null（中途半端な名前のフォルダを作らない）。
 */
export function apoAttachmentFolderName(
  apoNumber: string | undefined,
  customerName: string | undefined,
): string | null {
  const number = sanitizeDropboxName(apoNumber ?? "");
  const name = sanitizeCustomerNameForDropbox(customerName ?? "");
  if (!number || !name) return null;
  return `${number}_${name}様`;
}

export type ApoAttachmentFolderPaths = {
  /** {root}/{年}年商談資料一式 */
  yearPath: string;
  /** {root}/{年}年商談資料一式/{アポ通番}_{顧客名}様 */
  folderPath: string;
};

/**
 * 保存先のパスを組み立てる。
 *
 * 年フォルダとアポフォルダの**両方**を返す。年フォルダが無いことがあるので、
 * 呼び出し側は上から順に作る。
 * 材料が欠けていれば null（推測で埋めない）。
 */
export function buildApoAttachmentPaths(opts: {
  rootPath: string;
  apoAcquiredDate: string | undefined;
  apoNumber: string | undefined;
  customerName: string | undefined;
}): ApoAttachmentFolderPaths | null {
  const root = opts.rootPath.trim().replace(/\/+$/, "");
  if (!root) return null;

  const year = apoAttachmentYearFolderName(opts.apoAcquiredDate);
  const folder = apoAttachmentFolderName(opts.apoNumber, opts.customerName);
  if (!year || !folder) return null;

  const yearPath = `${root}/${year}`;
  return { yearPath, folderPath: `${yearPath}/${folder}` };
}

/* ------------------------------------------------------------------ *
 * ファイル形式の検証
 * ------------------------------------------------------------------ */

/** 受け付ける形式。拡張子と MIME の対応 */
const ALLOWED_TYPES: ReadonlyArray<{
  extension: string;
  mimeTypes: readonly string[];
}> = [
  { extension: "pdf", mimeTypes: ["application/pdf"] },
  { extension: "jpg", mimeTypes: ["image/jpeg", "image/jpg"] },
  { extension: "jpeg", mimeTypes: ["image/jpeg", "image/jpg"] },
  { extension: "png", mimeTypes: ["image/png"] },
];

export const APO_ATTACHMENT_ALLOWED_EXTENSIONS: readonly string[] =
  ALLOWED_TYPES.map((t) => t.extension);

/** 拡張子を取り出す。許可リストに無ければ null（ファイル名は信用しない） */
export function apoAttachmentExtension(originalName: string): string | null {
  const name = (originalName ?? "").trim();
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (!/^[a-z0-9]+$/.test(ext)) return null;
  return APO_ATTACHMENT_ALLOWED_EXTENSIONS.includes(ext) ? ext : null;
}

/** 拡張子と MIME が食い違っていないか */
export function apoAttachmentMimeMatchesExtension(
  extension: string,
  mimeType: string,
): boolean {
  const entry = ALLOWED_TYPES.find((t) => t.extension === extension);
  if (!entry) return false;
  const mime = (mimeType ?? "").trim().toLowerCase().split(";")[0]?.trim() ?? "";
  // 端末によっては MIME が空で届く。その場合は拡張子と先頭バイトで判断する
  if (!mime) return true;
  return entry.mimeTypes.includes(mime);
}

/**
 * 先頭バイトが形式と合っているか。
 *
 * 本格的な解析はしない。拡張子と MIME を偽った実行ファイルの混入を
 * 弾くのが目的で、PDF・JPEG・PNG の署名だけを見る。
 */
export function apoAttachmentSignatureMatches(
  extension: string,
  head: Uint8Array,
): boolean {
  const startsWith = (...bytes: number[]): boolean =>
    bytes.every((b, i) => head[i] === b);

  switch (extension) {
    case "pdf":
      // %PDF
      return startsWith(0x25, 0x50, 0x44, 0x46);
    case "jpg":
    case "jpeg":
      return startsWith(0xff, 0xd8, 0xff);
    case "png":
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    default:
      return false;
  }
}

export type ApoAttachmentTypeCheck =
  | { ok: true; extension: string }
  | { ok: false; reason: "extension" | "mime" | "signature" };

/**
 * 形式の検証をまとめて行う。拡張子 → MIME → 先頭バイトの順。
 *
 * クライアントの accept 属性は選択ダイアログの絞り込みでしかなく、
 * 強制力が無い。サーバでも必ず通すこと。
 */
export function checkApoAttachmentType(opts: {
  fileName: string;
  mimeType: string;
  head: Uint8Array;
}): ApoAttachmentTypeCheck {
  const extension = apoAttachmentExtension(opts.fileName);
  if (!extension) return { ok: false, reason: "extension" };
  if (!apoAttachmentMimeMatchesExtension(extension, opts.mimeType)) {
    return { ok: false, reason: "mime" };
  }
  if (!apoAttachmentSignatureMatches(extension, opts.head)) {
    return { ok: false, reason: "signature" };
  }
  return { ok: true, extension };
}

/* ------------------------------------------------------------------ *
 * 画面表示
 * ------------------------------------------------------------------ */

/**
 * 通知文を失敗として見せるか。
 *
 * 登録と添付を別のリクエストに分けたので、
 * 「登録しました。添付1件の送信に失敗しました」のように
 * 成功と失敗が1つの文に混ざる。成功語の有無だけでは判定できないため、
 * 失敗語があれば失敗として扱う。
 */
export function apoAcquisitionFeedbackIsError(message: string): boolean {
  const text = (message ?? "").trim();
  if (!text) return false;
  if (text.includes("失敗") || text.includes("できません")) return true;
  return !text.includes("しました");
}
