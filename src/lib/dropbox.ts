import "server-only";

import { joinDropboxPath } from "@/lib/dropbox-folder-name";

/**
 * Dropbox クライアント（顧客フォルダの作成・リネームのみ）。
 *
 * **削除系の関数は意図的に持たない。** アプリに削除権限を与えていないうえ、
 * 顧客書類のフォルダを誤って消せる経路をコードベースに作らないため。
 * files/delete_v2・files/permanently_delete は呼ばない。
 *
 * ── E-0 で確定した前提 ───────────────────────────────────
 * このアカウントはチームスペース（root_info[".tag"]=user・business/team あり）で、
 * root_namespace_id と home_namespace_id が異なる。
 * DROPBOX_CUSTOMER_ROOT_PATH へはヘッダ無し（個人スペース）だと
 * 409 path/not_found になり、**Dropbox-API-Path-Root 付きでのみ到達できる**。
 * よって全ての files/*・sharing/* 呼び出しにこのヘッダを付ける。
 *
 * root_namespace_id は users/get_current_account から**実行時に取得**する。
 * ハードコードするとチーム構成が変わったときに壊れる。取得後はプロセスメモリに
 * キャッシュする。
 *
 * ── ログの方針 ──────────────────────────────────────────
 * アクセストークン・リフレッシュトークン・アプリキー・シークレットは
 * 一切ログに出さない。Dropbox のエラー本文には内部パス構造が載るため、
 * クライアントへは返さずサーバログにのみ残す（api-error-response.ts と同じ方針）。
 */

const OAUTH_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const RPC_BASE = "https://api.dropboxapi.com";

/** 期限ちょうどに使うと往復中に切れるので手前で取り直す */
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/**
 * Dropbox 由来の失敗。
 * message には Dropbox の error_summary が入りうるため**クライアントへ返さない**。
 */
export class DropboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DropboxError";
  }
}

type DropboxConfig = {
  appKey: string;
  appSecret: string;
  refreshToken: string;
  rootPath: string;
};

function readDropboxConfig(): DropboxConfig | null {
  const appKey = process.env.DROPBOX_APP_KEY?.trim();
  const appSecret = process.env.DROPBOX_APP_SECRET?.trim();
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN?.trim();
  const rootPath = process.env.DROPBOX_CUSTOMER_ROOT_PATH?.trim();
  if (!appKey || !appSecret || !refreshToken || !rootPath) return null;
  return {
    appKey,
    appSecret,
    refreshToken,
    // 末尾スラッシュ付きのパスを Dropbox は受け付けない
    rootPath: rootPath.replace(/\/+$/, ""),
  };
}

/** 4変数が揃っているか。未設定なら Dropbox 連携そのものを行わない */
export function dropboxConfigured(): boolean {
  return readDropboxConfig() !== null;
}

/** 顧客フォルダの親パス（未設定時 null）。リネーム時に旧パスを組むのに使う */
export function dropboxCustomerRootPath(): string | null {
  return readDropboxConfig()?.rootPath ?? null;
}

// ───────────────────────────────────── アクセストークン

type TokenCacheEntry = { accessToken: string; expiresAt: number };

let tokenCache: TokenCacheEntry | null = null;
let tokenInflight: Promise<string> | null = null;

/** テスト・運用でキャッシュを捨てたいとき */
export function resetDropboxCachesForTest(): void {
  tokenCache = null;
  tokenInflight = null;
  rootNamespaceCache = null;
  rootNamespaceInflight = null;
}

async function requestAccessToken(cfg: DropboxConfig): Promise<TokenCacheEntry> {
  const basic = Buffer.from(`${cfg.appKey}:${cfg.appSecret}`).toString("base64");
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cfg.refreshToken,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    // 本文にトークンの値は載らない（Dropbox はエラーコードのみ返す）
    throw new DropboxError(`oauth2/token ${res.status}: ${text.slice(0, 300)}`);
  }

  let json: { access_token?: unknown; expires_in?: unknown };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new DropboxError("oauth2/token の応答を JSON として解釈できません");
  }

  const accessToken = json.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new DropboxError("oauth2/token の応答に access_token がありません");
  }

  const expiresIn =
    typeof json.expires_in === "number" && Number.isFinite(json.expires_in)
      ? json.expires_in
      : null;

  // expires_in が取れないときはキャッシュしない（expiresAt=0 で必ず期限切れ扱い）。
  // 期限を推測してキャッシュすると、切れたトークンを使い続けて全件失敗しうる。
  const expiresAt =
    expiresIn === null
      ? 0
      : Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_MARGIN_MS;

  return { accessToken, expiresAt };
}

/**
 * アクセストークンを取得する。
 * アプリ全体で1本なのでキャッシュキーは持たない。
 * 同時リクエストが同じ取得を重ねないよう inflight を共有する。
 */
async function accessTokenCached(cfg: DropboxConfig): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.accessToken;
  }
  if (tokenInflight) return tokenInflight;

  const promise = (async () => {
    try {
      const entry = await requestAccessToken(cfg);
      // 期限が読めなかった場合（expiresAt=0）はキャッシュに載せない
      tokenCache = entry.expiresAt > Date.now() ? entry : null;
      return entry.accessToken;
    } finally {
      tokenInflight = null;
    }
  })();

  tokenInflight = promise;
  return promise;
}

// ───────────────────────────────────── root namespace

let rootNamespaceCache: string | null = null;
let rootNamespaceInflight: Promise<string> | null = null;

async function requestRootNamespaceId(accessToken: string): Promise<string> {
  // 引数を取らないエンドポイントなので Content-Type を付けない（付けると 400）
  const res = await fetch(`${RPC_BASE}/2/users/get_current_account`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new DropboxError(
      `users/get_current_account ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  let json: { root_info?: { root_namespace_id?: unknown } };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new DropboxError(
      "users/get_current_account の応答を JSON として解釈できません",
    );
  }
  const id = json.root_info?.root_namespace_id;
  if (id === undefined || id === null || String(id).trim() === "") {
    throw new DropboxError(
      "users/get_current_account の応答に root_namespace_id がありません",
    );
  }
  return String(id).trim();
}

/** root_namespace_id を実行時に取得してキャッシュする（ハードコードしない） */
async function rootNamespaceIdCached(accessToken: string): Promise<string> {
  if (rootNamespaceCache) return rootNamespaceCache;
  if (rootNamespaceInflight) return rootNamespaceInflight;

  const promise = (async () => {
    try {
      const id = await requestRootNamespaceId(accessToken);
      rootNamespaceCache = id;
      return id;
    } finally {
      rootNamespaceInflight = null;
    }
  })();

  rootNamespaceInflight = promise;
  return promise;
}

// ───────────────────────────────────── 共通リクエスト

type DropboxRpcResult = {
  ok: boolean;
  status: number;
  json: Record<string, unknown> | null;
  text: string;
};

/** Dropbox のエラー本文から `.tag` を取り出す（例: path/conflict/folder） */
function errorTagOf(result: DropboxRpcResult): string {
  const summary = result.json?.error_summary;
  return typeof summary === "string" ? summary : "";
}

/**
 * files/* ・sharing/* 用の RPC。
 * **Dropbox-API-Path-Root を必ず付ける**（E-0 の結果より）。
 */
async function dropboxRpc(
  endpoint: string,
  args: Record<string, unknown>,
  cfg: DropboxConfig,
): Promise<DropboxRpcResult> {
  const accessToken = await accessTokenCached(cfg);
  const rootNamespaceId = await rootNamespaceIdCached(accessToken);

  const res = await fetch(`${RPC_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Dropbox-API-Path-Root": JSON.stringify({
        ".tag": "root",
        root: rootNamespaceId,
      }),
    },
    body: JSON.stringify(args),
  });

  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

function rpcFailure(endpoint: string, result: DropboxRpcResult): DropboxError {
  const summary = errorTagOf(result) || result.text.slice(0, 300);
  return new DropboxError(`${endpoint} ${result.status}: ${summary}`);
}

// ───────────────────────────────────── 共有リンク

/**
 * 共有リンクの公開範囲。**必ず明示する。**
 *
 * settings を省くと公開範囲が Dropbox のチーム既定設定に委ねられ、
 * 実際にログアウト状態のブラウザから中身が見える状態になっていた。
 * このフォルダには顧客の個人情報が入るため、既定に任せてはならない。
 *
 * audience: "team"   … チームメンバー以外はアクセスできない
 * access:   "viewer" … 閲覧のみ（編集させない）
 * allow_download: true … 業務上ダウンロードは必要
 */
const SHARED_LINK_SETTINGS = {
  audience: "team",
  access: "viewer",
  allow_download: true,
} as const;

/**
 * 外部から到達できてしまう可視性。これらのリンクは**使わない**。
 *
 * "password" も含めている。パスワード付きでも「チーム外の人がURLを知れば
 * 到達しうる」点は public と変わらず、そのパスワードはこのアプリの管理外のため。
 */
const PUBLIC_EQUIVALENT_VISIBILITIES: ReadonlySet<string> = new Set([
  "public",
  "password",
]);

function readSharedLinkUrl(json: Record<string, unknown> | null): string {
  const url = json?.url;
  return typeof url === "string" ? url.trim() : "";
}

/** link_permissions.resolved_visibility の .tag（読めなければ null） */
function readResolvedVisibility(
  json: Record<string, unknown> | null,
): string | null {
  const perms = json?.link_permissions;
  if (!perms || typeof perms !== "object") return null;
  const resolved = (perms as Record<string, unknown>).resolved_visibility;
  if (!resolved || typeof resolved !== "object") return null;
  const tag = (resolved as Record<string, unknown>)[".tag"];
  return typeof tag === "string" && tag ? tag : null;
}

export type SharedLinkCheck =
  /** そのまま使ってよい */
  | { kind: "ok"; url: string }
  /** 外部へ開いている／安全と確認できない。使ってはならない */
  | { kind: "unsafe"; visibility: string }
  /** url が読めない（可視性の問題ではない） */
  | { kind: "no-url" };

/**
 * リンクを使ってよいか判定する。
 *
 * 可視性が読めない場合も "unsafe" 扱いにする（フェイルクローズ）。
 * 顧客の個人情報が入るフォルダで「確認できないが多分大丈夫」を通すと、
 * 今回と同じ事故がもう一度起きるため。
 *
 * ネットワークに触れない純粋関数なので export してテストしている
 * （公開範囲の判定は事故が起きた箇所そのもので、退行を検知したい）。
 */
export function checkSharedLink(
  json: Record<string, unknown> | null,
): SharedLinkCheck {
  const url = readSharedLinkUrl(json);
  if (!url) return { kind: "no-url" };

  const visibility = readResolvedVisibility(json);
  if (!visibility) return { kind: "unsafe", visibility: "(取得できず)" };
  if (PUBLIC_EQUIVALENT_VISIBILITIES.has(visibility)) {
    return { kind: "unsafe", visibility };
  }
  return { kind: "ok", url };
}

/** ログにフルパスを出さない（親階層の構造を残さない）。末尾のフォルダ名だけ */
function folderNameForLog(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/**
 * 既存の共有リンクを拾う（直リンクのみ）。
 * 外部へ開いているリンクは**使わず**、警告をサーバログに残す。
 */
async function existingSharedLinkUrl(
  path: string,
  cfg: DropboxConfig,
): Promise<string> {
  const listed = await dropboxRpc(
    "/2/sharing/list_shared_links",
    { path, direct_only: true },
    cfg,
  );
  if (!listed.ok) throw rpcFailure("sharing/list_shared_links", listed);

  const links = listed.json?.links;
  if (!Array.isArray(links)) return "";

  for (const link of links) {
    const checked = checkSharedLink(link as Record<string, unknown>);
    if (checked.kind === "ok") return checked.url;
    if (checked.kind === "unsafe") {
      console.error(
        "[dropbox] 既存の共有リンクが外部へ開いている（または可視性を確認できない）ため使用しません。" +
          "Dropbox 側でこのフォルダの共有リンクを「チームのみ」に直してください: " +
          `folder=${folderNameForLog(path)} resolved_visibility=${checked.visibility}`,
      );
    }
  }
  return "";
}

/**
 * 共有リンクを取得する。
 *
 * 公開範囲は SHARED_LINK_SETTINGS で明示する。既にリンクがある場合
 * create_shared_link_with_settings は shared_link_already_exists を返すので、
 * list_shared_links で拾い直したうえで可視性を検証する。
 *
 * audience: "team" がプラン・ポリシーで拒否された場合は**そのまま失敗させる**。
 * "public" へフォールバックしない（それでは今回の事故の再現になる）。
 */
async function sharedLinkUrlFor(
  path: string,
  cfg: DropboxConfig,
): Promise<string> {
  const created = await dropboxRpc(
    "/2/sharing/create_shared_link_with_settings",
    { path, settings: SHARED_LINK_SETTINGS },
    cfg,
  );

  if (created.ok) {
    const checked = checkSharedLink(created.json);
    if (checked.kind === "ok") return checked.url;
    if (checked.kind === "unsafe") {
      throw new DropboxError(
        "作成した共有リンクの公開範囲が想定と異なります（audience=team を指定済み）: " +
          `folder=${folderNameForLog(path)} resolved_visibility=${checked.visibility}`,
      );
    }
    // url が読めないだけ。既存リンク側を見る
  } else {
    const tag = errorTagOf(created);
    if (tag.includes("settings_error")) {
      // audience=team がプラン・ポリシーで許可されていない可能性。推測で緩めない
      throw new DropboxError(
        "sharing/create_shared_link_with_settings が settings を拒否しました。" +
          "audience=team がこのチームのプラン・共有ポリシーで許可されているか確認してください: " +
          tag,
      );
    }
    if (!tag.includes("shared_link_already_exists")) {
      throw rpcFailure("sharing/create_shared_link_with_settings", created);
    }
  }

  const existing = await existingSharedLinkUrl(path, cfg);
  if (existing) return existing;
  throw new DropboxError(
    "使用できる共有リンクを取得できませんでした" +
      "（既存リンクが外部公開・可視性未確認のため不採用、またはリンクなし）: " +
      `folder=${folderNameForLog(path)}`,
  );
}

// ───────────────────────────────────── 公開 API

export type DropboxFolderResult = {
  /** Dropbox 上のフルパス */
  path: string;
  /** 共有リンク URL */
  url: string;
};

/**
 * 顧客フォルダを用意して共有リンクを返す。
 *
 * 既に同名フォルダがある場合は**エラーにせず**、既存フォルダの共有リンクを返す。
 * 同じ顧客の再登録や、手動で先に作られていた場合に備える。
 *
 * folderName は buildCustomerFolderName でサニタイズ済みのものを渡すこと。
 */
export async function ensureCustomerFolder(
  folderName: string,
): Promise<DropboxFolderResult> {
  const cfg = readDropboxConfig();
  if (!cfg) {
    throw new DropboxError("Dropbox の環境変数が未設定です");
  }
  const name = folderName.trim();
  if (!name) {
    throw new DropboxError("フォルダ名が空です");
  }

  const path = joinDropboxPath(cfg.rootPath, name);

  const created = await dropboxRpc(
    "/2/files/create_folder_v2",
    { path, autorename: false },
    cfg,
  );

  if (!created.ok) {
    const tag = errorTagOf(created);
    // 既存フォルダは正常系。それ以外の失敗だけ投げる
    if (!tag.includes("path/conflict")) {
      throw rpcFailure("files/create_folder_v2", created);
    }
  }

  const url = await sharedLinkUrlFor(path, cfg);
  return { path, url };
}

/**
 * 既に存在するフォルダの共有リンクだけを取る（タスクN の一括紐付け用）。
 *
 * ensureCustomerFolder との違いは **files/create_folder_v2 を呼ばない**点だけ。
 * 一括紐付けの対象は Dropbox 上に実在するフォルダに限られ（一覧で確認済み）、
 * 作成を試しても必ず path/conflict になる。1件あたり1往復の無駄になるので省く。
 *
 * 共有リンクの取得は ensureCustomerFolder と**同じ sharedLinkUrlFor** を通す。
 * audience="team" の明示と resolved_visibility の検証はその中にあり、
 * 速度のためにこの検証を飛ばすことはしない。
 */
export async function customerFolderSharedLink(
  folderName: string,
): Promise<DropboxFolderResult> {
  const cfg = readDropboxConfig();
  if (!cfg) {
    throw new DropboxError("Dropbox の環境変数が未設定です");
  }
  const name = folderName.trim();
  if (!name) {
    throw new DropboxError("フォルダ名が空です");
  }

  const path = joinDropboxPath(cfg.rootPath, name);
  const url = await sharedLinkUrlFor(path, cfg);
  return { path, url };
}

/**
 * 顧客フォルダをリネームして、リネーム後の共有リンクを返す。
 * 顧客名の変更時に使う。
 */
export async function renameCustomerFolder(
  oldPath: string,
  newPath: string,
): Promise<string> {
  const cfg = readDropboxConfig();
  if (!cfg) {
    throw new DropboxError("Dropbox の環境変数が未設定です");
  }
  const from = oldPath.trim();
  const to = newPath.trim();
  if (!from || !to) {
    throw new DropboxError("リネーム元／先のパスが空です");
  }
  if (from === to) {
    return sharedLinkUrlFor(to, cfg);
  }

  const moved = await dropboxRpc(
    "/2/files/move_v2",
    { from_path: from, to_path: to, autorename: false },
    cfg,
  );

  if (!moved.ok) {
    const tag = errorTagOf(moved);
    // 移動先が既にある＝別経路で作成済み。その既存フォルダのリンクを返す
    if (!tag.includes("to/conflict")) {
      throw rpcFailure("files/move_v2", moved);
    }
  }

  return sharedLinkUrlFor(to, cfg);
}

// ───────────────────────────────────── 書類アップロード（タスクF）

/** 既存ファイルと衝突した。連番の計算に漏れがあったことを示す */
export class DropboxUploadConflictError extends DropboxError {
  constructor(message: string) {
    super(message);
    this.name = "DropboxUploadConflictError";
  }
}

/** 顧客フォルダのフルパス（Dropbox 未設定なら null） */
export function dropboxCustomerFolderPath(folderName: string): string | null {
  const cfg = readDropboxConfig();
  const name = folderName.trim();
  if (!cfg || !name) return null;
  return joinDropboxPath(cfg.rootPath, name);
}

function readEntryName(entry: unknown): string {
  if (!entry || typeof entry !== "object") return "";
  const o = entry as Record<string, unknown>;
  return typeof o.name === "string" ? o.name.trim() : "";
}

/**
 * フォルダ直下のファイル名一覧。連番の決定に使う。
 * has_more のときは list_folder/continue で最後まで辿る。
 */
export async function listCustomerFolderFileNames(
  folderPath: string,
): Promise<string[]> {
  const cfg = readDropboxConfig();
  if (!cfg) throw new DropboxError("Dropbox の環境変数が未設定です");

  const names: string[] = [];
  let result = await dropboxRpc(
    "/2/files/list_folder",
    { path: folderPath, recursive: false, limit: 2000 },
    cfg,
  );
  if (!result.ok) throw rpcFailure("files/list_folder", result);

  // 連番が飛ぶ事故を避けるため全ページ辿る。上限は暴走防止のバックストップ
  for (let page = 0; page < 20; page++) {
    for (const entry of (result.json?.entries as unknown[]) ?? []) {
      const name = readEntryName(entry);
      if (name) names.push(name);
    }
    if (result.json?.has_more !== true) break;
    const cursor = result.json?.cursor;
    if (typeof cursor !== "string" || !cursor) break;
    result = await dropboxRpc("/2/files/list_folder/continue", { cursor }, cfg);
    if (!result.ok) throw rpcFailure("files/list_folder/continue", result);
  }

  return names;
}

/**
 * Dropbox-API-Arg は HTTP ヘッダなので **ASCII でなければならない**。
 * 日本語のファイル名をそのまま載せると送信時に壊れるため \uXXXX へ逃がす。
 */
function asciiSafeApiArg(args: Record<string, unknown>): string {
  const json = JSON.stringify(args);
  let out = "";
  for (const ch of json) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) {
      out += ch;
      continue;
    }
    // サロゲートペアも1つずつ \uXXXX にする（Dropbox はこの形を受け付ける）
    for (let i = 0; i < ch.length; i++) {
      out += "\\u" + ch.charCodeAt(i).toString(16).padStart(4, "0");
    }
  }
  return out;
}

/**
 * ファイルを格納する。
 *
 * mode は "add"、autorename は false。**既存ファイルを上書きしない。**
 * 取り消し機能が無いため、上書きは復旧不能な事故になる。
 * strict_conflict を立てて、内容が同一でも衝突として扱わせる。
 */
export async function uploadCustomerFile(
  filePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const cfg = readDropboxConfig();
  if (!cfg) throw new DropboxError("Dropbox の環境変数が未設定です");

  const accessToken = await accessTokenCached(cfg);
  const rootNamespaceId = await rootNamespaceIdCached(accessToken);

  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Path-Root": JSON.stringify({
        ".tag": "root",
        root: rootNamespaceId,
      }),
      "Dropbox-API-Arg": asciiSafeApiArg({
        path: filePath,
        mode: "add",
        autorename: false,
        mute: true,
        strict_conflict: true,
      }),
    },
    body: bytes as unknown as BodyInit,
  });

  if (res.ok) return;

  const text = await res.text();
  let summary = text.slice(0, 300);
  try {
    const j = JSON.parse(text) as { error_summary?: unknown };
    if (typeof j.error_summary === "string") summary = j.error_summary;
  } catch {
    /* JSON でない応答はそのまま使う */
  }

  if (summary.includes("conflict")) {
    throw new DropboxUploadConflictError(
      `files/upload ${res.status}: ${summary}`,
    );
  }
  throw new DropboxError(`files/upload ${res.status}: ${summary}`);
}
