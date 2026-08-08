#!/usr/bin/env node
/**
 * タスク E-0 疎通確認（読み取り専用）
 *
 * Dropbox はチームフォルダのパス解決が個人スペースと異なるため、
 * フォルダ作成の実装に入る前に次を確定させる：
 *   1. リフレッシュトークンからアクセストークンを取得できるか
 *   2. root_info の .tag と root_namespace_id（home_namespace_id との異同）
 *   3. DROPBOX_CUSTOMER_ROOT_PATH に **Dropbox-API-Path-Root 付き**で到達できるか
 *   4. 到達できなければ **ヘッダ無し（個人スペース）**でも試す
 *   5. どちらでも到達できなければ、実際のパス構造を列挙して報告する
 *
 * このスクリプトは書き込み API を一切呼ばない。
 * 使うのは次の4つだけで、いずれも参照系：
 *   POST /oauth2/token (grant_type=refresh_token)
 *   POST /2/users/get_current_account
 *   POST /2/files/get_metadata
 *   POST /2/files/list_folder
 * files/create_folder_v2・files/move_v2・files/delete_v2・sharing/* は呼ばない。
 *
 * ── 実行方法 ──────────────────────────────────────────────
 *   node scripts/dropbox/probe-connectivity.mjs --env-path .env.local
 *
 * ⚠ フラグ名は --env-path。--env-file は Node 20.6+ の**組み込みオプション**と衝突し、
 *   スクリプトへ渡る前に Node 自身が横取りする（scripts/audit と同じ理由）。
 *
 * ── 出力について ──────────────────────────────────────────
 * アクセストークン・リフレッシュトークン・アプリキー・シークレットは
 * **一切出力しない**。namespace id は「同一/相異」の判定と、
 * 実装で Dropbox-API-Path-Root に入れる値の確認に必要なため出力する
 * （それ自体は秘密情報ではないが、報告に貼るときは伏せてよい）。
 * --mask-ids を付けると namespace id も伏せる。
 */

import { readFileSync, existsSync } from "node:fs";

// ─────────────────────────────────────────────────────────── CLI

function parseArgs(argv) {
  const out = { envPath: null, maskIds: false, listDepth: 2, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--env-path") out.envPath = argv[++i] ?? null;
    else if (a === "--mask-ids") out.maskIds = true;
    else if (a === "--list-depth") out.listDepth = Number(argv[++i] ?? 2);
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const HELP = `タスク E-0 Dropbox 疎通確認（読み取り専用）

  node scripts/dropbox/probe-connectivity.mjs [options]

  --env-path <path>   .env 形式のファイルを読み込む（既定: .env.local → .env）
  --mask-ids          namespace id も伏せて出力する
  --list-depth <n>    パス未到達時に列挙する階層の深さ（既定 2）
  --help
`;

/** .env 形式のファイルを process.env に読み込む（既存の process.env を上書きしない） */
function loadEnvFile(path) {
  if (!path || !existsSync(path)) return false;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  return true;
}

// ─────────────────────────────────────────────────────── Dropbox

const OAUTH_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const RPC_BASE = "https://api.dropboxapi.com";

/**
 * リフレッシュトークン → アクセストークン。
 * 失敗時の本文には値が載らない（Dropbox はエラーコードのみ返す）が、
 * 念のため 300 文字で切っている。
 */
async function fetchAccessToken({ appKey, appSecret, refreshToken }) {
  const basic = Buffer.from(`${appKey}:${appSecret}`).toString("base64");
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`oauth2/token ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text);
  if (!json.access_token || typeof json.access_token !== "string") {
    throw new Error("oauth2/token の応答に access_token がありません");
  }
  return {
    accessToken: json.access_token,
    expiresIn:
      typeof json.expires_in === "number" ? json.expires_in : undefined,
  };
}

/**
 * Dropbox RPC 呼び出し。
 * args が null の endpoint（users/get_current_account）は
 * **Content-Type を付けない**（付けると 400 になる）。
 */
async function rpc(endpoint, args, { accessToken, pathRoot }) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  if (pathRoot) headers["Dropbox-API-Path-Root"] = pathRoot;
  const init = { method: "POST", headers };
  if (args !== null && args !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(args);
  }

  const res = await fetch(`${RPC_BASE}${endpoint}`, init);
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    body: text,
    json: (() => {
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return null;
      }
    })(),
  };
}

function pathRootHeaderValue(rootNamespaceId) {
  return JSON.stringify({ ".tag": "root", root: String(rootNamespaceId) });
}

/** 「/BY/1.顧客情報/2.お客様書類」→ ["/BY", "/BY/1.顧客情報", "/BY/1.顧客情報/2.お客様書類"] */
function ancestorPaths(fullPath) {
  const segments = fullPath.split("/").filter(Boolean);
  const out = [];
  let acc = "";
  for (const s of segments) {
    acc += `/${s}`;
    out.push(acc);
  }
  return out;
}

function mask(value, enabled) {
  if (!enabled) return value;
  const s = String(value ?? "");
  if (s.length <= 4) return "****";
  return `${s.slice(0, 2)}…${s.slice(-2)} (len=${s.length})`;
}

/** get_metadata の結果を1行で要約（エラー時は Dropbox の error_summary のみ） */
function describeMetadata(result) {
  if (result.ok) {
    const j = result.json ?? {};
    return `OK  .tag=${j[".tag"] ?? "?"} name=${j.name ?? "?"} path_display=${j.path_display ?? "?"}`;
  }
  const summary = result.json?.error_summary ?? result.body.slice(0, 200);
  return `NG  status=${result.status} ${summary}`;
}

// ─────────────────────────────────────────────────────────── main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const loaded =
    loadEnvFile(args.envPath) || loadEnvFile(".env.local") || loadEnvFile(".env");
  process.stdout.write(
    `env ファイル: ${loaded ? (args.envPath ?? ".env.local / .env") : "読み込まれず（process.env のみ）"}\n\n`,
  );

  const appKey = process.env.DROPBOX_APP_KEY?.trim();
  const appSecret = process.env.DROPBOX_APP_SECRET?.trim();
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN?.trim();
  const rootPathRaw = process.env.DROPBOX_CUSTOMER_ROOT_PATH?.trim();

  const missing = [
    ["DROPBOX_APP_KEY", appKey],
    ["DROPBOX_APP_SECRET", appSecret],
    ["DROPBOX_REFRESH_TOKEN", refreshToken],
    ["DROPBOX_CUSTOMER_ROOT_PATH", rootPathRaw],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    process.stderr.write(`未設定の環境変数: ${missing.join(", ")}\n`);
    process.exitCode = 1;
    return;
  }

  // 末尾スラッシュを落とす（Dropbox は "/a/b/" を受け付けない）
  const rootPath = rootPathRaw.replace(/\/+$/, "");
  process.stdout.write(`DROPBOX_CUSTOMER_ROOT_PATH: ${rootPath}\n\n`);

  // ── 1. アクセストークン ────────────────────────────────
  process.stdout.write("── 1. oauth2/token（refresh_token）\n");
  const { accessToken, expiresIn } = await fetchAccessToken({
    appKey,
    appSecret,
    refreshToken,
  });
  process.stdout.write(
    `OK  アクセストークン取得（値は出力しない）expires_in=${expiresIn ?? "不明"}秒\n\n`,
  );

  // ── 2. users/get_current_account ───────────────────────
  process.stdout.write("── 2. users/get_current_account（root_info）\n");
  const account = await rpc("/2/users/get_current_account", null, {
    accessToken,
  });
  if (!account.ok) {
    process.stderr.write(
      `NG  status=${account.status} ${account.json?.error_summary ?? account.body.slice(0, 300)}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const rootInfo = account.json?.root_info ?? {};
  const rootNamespaceId = rootInfo.root_namespace_id;
  const homeNamespaceId = rootInfo.home_namespace_id;
  process.stdout.write(`root_info[".tag"]  : ${rootInfo[".tag"] ?? "?"}\n`);
  process.stdout.write(
    `root_namespace_id  : ${mask(rootNamespaceId, args.maskIds)}\n`,
  );
  process.stdout.write(
    `home_namespace_id  : ${mask(homeNamespaceId, args.maskIds)}\n`,
  );
  process.stdout.write(
    `同一か             : ${String(rootNamespaceId) === String(homeNamespaceId) ? "同一（＝個人スペースと同じ）" : "相異（＝チームスペース）"}\n`,
  );
  process.stdout.write(
    `アカウント種別     : ${account.json?.account_type?.[".tag"] ?? "?"} / team=${account.json?.team ? "あり" : "なし"}\n\n`,
  );

  if (!rootNamespaceId) {
    process.stderr.write(
      "root_namespace_id を取得できませんでした。ここで停止します。\n",
    );
    process.exitCode = 1;
    return;
  }

  const pathRoot = pathRootHeaderValue(rootNamespaceId);

  // ── 3/4. get_metadata（ヘッダ有り → 無し）────────────────
  process.stdout.write("── 3. files/get_metadata（Dropbox-API-Path-Root 有り）\n");
  const withHeader = await rpc(
    "/2/files/get_metadata",
    { path: rootPath },
    { accessToken, pathRoot },
  );
  process.stdout.write(`${describeMetadata(withHeader)}\n\n`);

  process.stdout.write("── 4. files/get_metadata（ヘッダ無し・個人スペース）\n");
  const withoutHeader = await rpc(
    "/2/files/get_metadata",
    { path: rootPath },
    { accessToken },
  );
  process.stdout.write(`${describeMetadata(withoutHeader)}\n\n`);

  const reachable = withHeader.ok
    ? "path-root 有り"
    : withoutHeader.ok
      ? "path-root 無し（個人スペース）"
      : null;

  process.stdout.write("── 判定\n");
  if (reachable) {
    process.stdout.write(`到達可能: ${reachable}\n`);
    process.stdout.write(
      `Dropbox-API-Path-Root の要否: ${withHeader.ok ? "必要（実装で常時付与する）" : "不要"}\n`,
    );
    if (withHeader.ok && withoutHeader.ok) {
      process.stdout.write(
        "※ 双方到達。同一パスが両名前空間に存在する可能性があるため path_display を突き合わせること\n",
      );
    }
    return;
  }

  // ── 5. どちらでも到達できない → 実構造を列挙して停止 ────
  process.stdout.write(
    "到達不可。実際のパス構造を列挙する（推測でパスを変えた再試行はしない）\n\n",
  );

  for (const mode of [
    { label: "path-root 有り", opts: { accessToken, pathRoot } },
    { label: "path-root 無し", opts: { accessToken } },
  ]) {
    process.stdout.write(`── 5. 祖先パスの到達可否（${mode.label}）\n`);
    let deepestOk = "";
    for (const p of ancestorPaths(rootPath)) {
      const r = await rpc("/2/files/get_metadata", { path: p }, mode.opts);
      process.stdout.write(`  ${p}\n    ${describeMetadata(r)}\n`);
      if (r.ok) deepestOk = p;
      else break;
    }

    process.stdout.write(`\n── 5. ルート直下の列挙（${mode.label}）\n`);
    const queue = [{ path: "", depth: 0 }];
    if (deepestOk) queue.push({ path: deepestOk, depth: 0 });
    const seen = new Set();
    while (queue.length > 0) {
      const { path: p, depth } = queue.shift();
      if (seen.has(p)) continue;
      seen.add(p);
      const listed = await rpc(
        "/2/files/list_folder",
        { path: p, limit: 200 },
        mode.opts,
      );
      if (!listed.ok) {
        process.stdout.write(
          `  ${p || "(namespace root)"} → NG status=${listed.status} ${listed.json?.error_summary ?? ""}\n`,
        );
        continue;
      }
      const entries = listed.json?.entries ?? [];
      process.stdout.write(
        `  ${p || "(namespace root)"} → ${entries.length} 件\n`,
      );
      for (const e of entries) {
        process.stdout.write(
          `    [${e[".tag"]}] ${e.path_display ?? e.name}\n`,
        );
        if (e[".tag"] === "folder" && depth + 1 < args.listDepth) {
          queue.push({ path: e.path_lower ?? e.path_display, depth: depth + 1 });
        }
      }
    }
    process.stdout.write("\n");
  }

  process.stderr.write(
    "DROPBOX_CUSTOMER_ROOT_PATH に到達できませんでした。上の列挙結果を報告し、作業を止めること。\n",
  );
  process.exitCode = 2;
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
