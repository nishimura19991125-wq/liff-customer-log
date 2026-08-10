#!/usr/bin/env node
/**
 * タスクK 事前調査（読み取り専用）
 *
 * 「目標登録(月次)」アプリの実データを見ないと決められない4点を確定させる。
 *   1. 目標月の値の形式（2026-08-01 / 2026/08/01 / その他）
 *   2. 担当者名が選択肢か文字列か。選択肢なら値とラベルのどちらが名簿の氏名か
 *   3. 部署・支社の選択肢の値
 *   4. 目標が登録されていないスタッフが存在するか（件数）
 *
 * 参照系のみを呼ぶ。書き込み API は一切呼ばない。
 *   POST /api/apps/{id}/fields   （X-HTTP-Method-Override: GET）
 *   POST /api/apps/{id}/records  （X-HTTP-Method-Override: GET）
 *
 * ── 実行方法 ──────────────────────────────────────────────
 *   node scripts/sales-target/probe-target-app.mjs --env-path .env.local
 *   netlify dev:exec -- node scripts/sales-target/probe-target-app.mjs
 *
 * ⚠ フラグ名は --env-path。--env-file は Node 20.6+ の組み込みオプションと
 *   衝突し、スクリプトへ渡る前に Node 自身が横取りする。
 *
 * ── 出力について ──────────────────────────────────────────
 * API キーは一切出力しない。
 * 担当者名・スタッフ氏名は既定で伏せる（1文字目＋伏せ字）。
 * 突合の実態を目で見たいときだけ --show-names を付ける。
 * 部署・支社は個人情報ではないためそのまま出す。
 */

import { readFileSync, existsSync } from "node:fs";

// ─────────────────────────────────────────────────────────── CLI

function parseArgs(argv) {
  const out = {
    envPath: null,
    showNames: false,
    sample: 3,
    maxPages: 5,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--env-path") out.envPath = argv[++i] ?? null;
    else if (a === "--show-names") out.showNames = true;
    else if (a === "--sample") out.sample = Number(argv[++i] ?? 3);
    else if (a === "--max-pages") out.maxPages = Number(argv[++i] ?? 5);
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const HELP = `タスクK 目標登録(月次)アプリ 事前調査（読み取り専用）

  node scripts/sales-target/probe-target-app.mjs [options]

  --env-path <path>  .env 形式のファイルを読み込む（既定: .env.local → .env）
  --show-names       担当者名・スタッフ氏名を伏せずに出す（既定は伏せる）
  --sample <n>       生の値の形を出すレコード数（既定 3）
  --max-pages <n>    取得ページ数の上限（既定 5・1ページ1000件）
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

// ─────────────────────────────────────────────────────── @pocket

function baseUrl() {
  const domain = process.env.ATPOCKET_DOMAIN?.trim();
  if (!domain) throw new Error("ATPOCKET_DOMAIN が未設定です");
  return `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
}

function authHeaderName() {
  return process.env.ATPOCKET_AUTH_HEADER?.trim() || "X-At-Pocket-API-Key";
}

function firstEnv(...names) {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** 参照系のみ。@pocket は GET を X-HTTP-Method-Override で受ける */
async function getJson(pathWithQuery, apiKey, label) {
  const res = await fetch(`${baseUrl()}${pathWithQuery}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      [authHeaderName()]: apiKey,
      "X-HTTP-Method-Override": "GET",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    // 本文に API キーは載らないが、念のため長さを切る
    throw new Error(`${label} ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function fetchFields(appId, apiKey) {
  const json = await getJson(
    `/api/apps/${encodeURIComponent(appId)}/fields?limit=1000&page=1`,
    apiKey,
    `fields(app=${appId})`,
  );
  return json.fields ?? [];
}

async function fetchAllRecords(appId, apiKey, maxPages) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const json = await getJson(
      `/api/apps/${encodeURIComponent(appId)}/records?limit=1000&page=${page}`,
      apiKey,
      `records(app=${appId},page=${page})`,
    );
    const rows = json.records ?? [];
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
}

// ─────────────────────────────────────────────────── 値の取り出し

function fieldProp(o, ...names) {
  for (const n of names) {
    if (o && typeof o === "object" && o[n] !== undefined) return o[n];
  }
  return undefined;
}

function normalizeField(raw) {
  if (!raw || typeof raw !== "object") return {};
  return {
    uniqueId: String(
      fieldProp(raw, "uniqueId", "field_unique_id", "fieldUniqueId") ?? "",
    ).trim(),
    caption: String(fieldProp(raw, "caption") ?? "").trim(),
    fieldType: String(fieldProp(raw, "fieldType", "field_type") ?? "").trim(),
  };
}

/** 記録側の値をそのまま拾う（uniqueId / field-N のゆれを吸収） */
function rawValueOf(recObj, uniqueId) {
  if (!recObj || typeof recObj !== "object") return undefined;
  if (recObj[uniqueId] !== undefined) return recObj[uniqueId];
  for (const [k, v] of Object.entries(recObj)) {
    if (k.toLowerCase() === uniqueId.toLowerCase()) return v;
  }
  return undefined;
}

/**
 * 表示用の文字列。@pocket は選択肢を文字列でも {value,label} でも返しうる。
 * ここでは **加工前の形も別途出す**ので、この関数は突合用の目安。
 */
function toDisplayString(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(toDisplayString).filter(Boolean).join(",");
  if (typeof v === "object") {
    const o = v;
    for (const k of ["label", "value", "name", "text", "caption"]) {
      if (typeof o[k] === "string" && o[k].trim()) return o[k].trim();
    }
    return "";
  }
  return "";
}

/** 選択肢が {value,label} で返るとき、両方を取り出す */
function valueAndLabel(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const value = typeof v.value === "string" ? v.value : undefined;
    const label = typeof v.label === "string" ? v.label : undefined;
    if (value !== undefined || label !== undefined) return { value, label };
  }
  return null;
}

function normName(raw) {
  return (raw ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function maskName(name, show) {
  if (show) return name;
  if (!name) return "";
  return `${[...name][0]}${"○".repeat(Math.max(1, [...name].length - 1))}`;
}

// ─────────────────────────────────────────────── 列の見出し解決

function findByCaptions(fields, captions) {
  const wanted = captions.map((c) => c.normalize("NFKC").trim());
  for (const f of fields) {
    const cap = f.caption.normalize("NFKC").trim();
    if (wanted.includes(cap)) return f;
  }
  return null;
}

// ─────────────────────────────────────────────────────────── main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const loaded =
    loadEnvFile(args.envPath) ||
    loadEnvFile(".env.local") ||
    loadEnvFile(".env");
  console.log(
    `env: ${loaded ? (args.envPath ?? ".env.local / .env") : "process.env のみ"}`,
  );

  const targetAppId = firstEnv("SALES_TARGET_APP_ID") ?? "20";
  const targetKey = firstEnv(
    "SALES_TARGET_ATPOCKET_API_KEY_FIELDS",
    "SALES_TARGET_ATPOCKET_API_KEY",
    "SALES_TARGET_ATPOCKET_API_KEY_1",
  );
  if (!targetKey) {
    console.error(
      "SALES_TARGET_ATPOCKET_API_KEY が未設定です。値は貼らずに、設定した旨だけ報告してください。",
    );
    process.exitCode = 1;
    return;
  }

  // ── 1. 列構成 ──────────────────────────────────────────
  console.log(`\n=== 1. 目標登録アプリ（appId=${targetAppId}）の列構成 ===`);
  const fieldsRaw = await fetchFields(targetAppId, targetKey);
  const fields = fieldsRaw.map(normalizeField).filter((f) => f.uniqueId);
  for (const f of fields) {
    console.log(`  ${f.uniqueId}\t${f.fieldType || "-"}\t${f.caption}`);
  }

  const col = {
    month: findByCaptions(fields, ["目標月"]),
    department: findByCaptions(fields, ["部署"]),
    branch: findByCaptions(fields, ["支社"]),
    staffName: findByCaptions(fields, ["担当者名"]),
    apoCount: findByCaptions(fields, ["アポ獲得件数"]),
    pt: findByCaptions(fields, ["目標粗利"]),
    contractCount: findByCaptions(fields, ["成約件数"]),
  };

  console.log("\n--- 見出し完全一致での解決結果 ---");
  for (const [key, f] of Object.entries(col)) {
    console.log(
      `  ${key.padEnd(14)} ${f ? `${f.uniqueId} (${f.fieldType || "-"})` : "★ 見つからない"}`,
    );
  }

  const missing = Object.entries(col)
    .filter(([, f]) => !f)
    .map(([k]) => k);
  if (missing.length > 0) {
    console.log(
      `\n★ 見出しが一致しない列があります: ${missing.join(", ")}\n` +
        "   上の列一覧の caption を確認し、環境変数で uniqueId を指定するか、\n" +
        "   解決に使う見出し候補を実装側へ追加する必要があります。",
    );
  }

  // ── 2. レコードの生の形 ────────────────────────────────
  const records = await fetchAllRecords(targetAppId, targetKey, args.maxPages);
  console.log(`\n=== 2. 目標レコード ${records.length} 件 ===`);

  const sample = records.slice(0, Math.max(0, args.sample));
  console.log(`\n--- 先頭 ${sample.length} 件の生の値（JSON のまま） ---`);
  for (const [i, row] of sample.entries()) {
    const rec = row?.record;
    if (!rec || typeof rec !== "object") continue;
    console.log(`  [${i}]`);
    for (const [key, f] of Object.entries(col)) {
      if (!f) continue;
      const raw = rawValueOf(rec, f.uniqueId);
      const shown =
        key === "staffName" && !args.showNames
          ? `（伏せ字: ${maskName(toDisplayString(raw), false)}）`
          : JSON.stringify(raw);
      console.log(`      ${key.padEnd(14)} ${shown}`);
    }
  }

  // ── 3. 目標月の形式 ────────────────────────────────────
  console.log("\n=== 3. 目標月の値の形式 ===");
  if (!col.month) {
    console.log("  目標月の列を解決できないため判定できません");
  } else {
    const shapes = new Map();
    for (const row of records) {
      const rec = row?.record;
      if (!rec || typeof rec !== "object") continue;
      const raw = rawValueOf(rec, col.month.uniqueId);
      const s = toDisplayString(raw);
      if (!s) {
        shapes.set("（空）", (shapes.get("（空）") ?? 0) + 1);
        continue;
      }
      // 数字を 9 に潰して形だけ見る
      const shape = s.replace(/\d/g, "9");
      shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
    }
    for (const [shape, count] of [...shapes].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${shape}\t${count}件`);
    }
    const distinctMonths = new Set(
      records
        .map((r) => toDisplayString(rawValueOf(r?.record ?? {}, col.month.uniqueId)))
        .filter(Boolean),
    );
    console.log(
      `  実際の値（重複なし・先頭20件）: ${[...distinctMonths].sort().slice(0, 20).join(", ")}`,
    );
  }

  // ── 4. 担当者名が選択肢か文字列か ──────────────────────
  console.log("\n=== 4. 担当者名の形 ===");
  if (!col.staffName) {
    console.log("  担当者名の列を解決できないため判定できません");
  } else {
    console.log(`  fieldType: ${col.staffName.fieldType || "(不明)"}`);
    let objectShaped = 0;
    let stringShaped = 0;
    let valueEqualsLabel = 0;
    let valueDiffersLabel = 0;
    const diffSamples = [];
    for (const row of records) {
      const rec = row?.record;
      if (!rec || typeof rec !== "object") continue;
      const raw = rawValueOf(rec, col.staffName.uniqueId);
      const vl = valueAndLabel(raw);
      if (vl) {
        objectShaped += 1;
        if (vl.value !== undefined && vl.label !== undefined) {
          if (vl.value === vl.label) valueEqualsLabel += 1;
          else {
            valueDiffersLabel += 1;
            if (diffSamples.length < 5) {
              diffSamples.push(
                `value=${maskName(vl.value, args.showNames)} / label=${maskName(vl.label, args.showNames)}`,
              );
            }
          }
        }
      } else if (typeof raw === "string") {
        stringShaped += 1;
      }
    }
    console.log(`  {value,label} 形式: ${objectShaped}件`);
    console.log(`  文字列: ${stringShaped}件`);
    if (objectShaped > 0) {
      console.log(`    うち value === label: ${valueEqualsLabel}件`);
      console.log(`    うち value !== label: ${valueDiffersLabel}件`);
      for (const s of diffSamples) console.log(`      ${s}`);
    }
  }

  // ── 5. 部署・支社の選択肢の値 ──────────────────────────
  console.log("\n=== 5. 部署・支社の値（個人情報ではないためそのまま出す） ===");
  for (const key of ["department", "branch"]) {
    const f = col[key];
    if (!f) {
      console.log(`  ${key}: 列を解決できません`);
      continue;
    }
    const counts = new Map();
    for (const row of records) {
      const rec = row?.record;
      if (!rec || typeof rec !== "object") continue;
      const s = toDisplayString(rawValueOf(rec, f.uniqueId)) || "（空）";
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    console.log(`  ${key}:`);
    for (const [v, c] of [...counts].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${v}\t${c}件`);
    }
  }

  // ── 6. 名簿との突合（目標が無いスタッフの件数） ────────
  console.log("\n=== 6. スタッフ名簿との突合 ===");
  const staffAppId = firstEnv("STAFF_APP_ID");
  const staffNameFieldId = firstEnv("STAFF_NAME_FIELD_ID");
  const staffKey = firstEnv(
    "STAFF_READ_ATPOCKET_API_KEY_1",
    "STAFF_READ_ATPOCKET_API_KEY",
    "ATPOCKET_API_KEY_1",
    "ATPOCKET_API_KEY",
  );

  if (!staffAppId || !staffNameFieldId || !staffKey) {
    console.log(
      "  STAFF_APP_ID / STAFF_NAME_FIELD_ID / 名簿用 API キーのいずれかが無いため突合できません",
    );
  } else {
    const staffFields = (await fetchFields(staffAppId, staffKey))
      .map(normalizeField)
      .filter((f) => f.uniqueId);
    const nameField =
      staffFields.find(
        (f) => f.uniqueId.toLowerCase() === staffNameFieldId.toLowerCase(),
      ) ?? findByCaptions(staffFields, ["氏名", "担当者名", "スタッフ名", "名前"]);

    if (!nameField) {
      console.log("  名簿の氏名列を解決できませんでした");
    } else {
      const staffRows = await fetchAllRecords(staffAppId, staffKey, args.maxPages);
      const rosterNames = new Set();
      for (const row of staffRows) {
        const rec = row?.record;
        if (!rec || typeof rec !== "object") continue;
        const n = normName(toDisplayString(rawValueOf(rec, nameField.uniqueId)));
        if (n) rosterNames.add(n);
      }

      const targetNames = new Set();
      if (col.staffName) {
        for (const row of records) {
          const rec = row?.record;
          if (!rec || typeof rec !== "object") continue;
          const n = normName(
            toDisplayString(rawValueOf(rec, col.staffName.uniqueId)),
          );
          if (n) targetNames.add(n);
        }
      }

      const noTarget = [...rosterNames].filter((n) => !targetNames.has(n));
      const noRoster = [...targetNames].filter((n) => !rosterNames.has(n));

      console.log(`  名簿の氏名: ${rosterNames.size}件`);
      console.log(`  目標の担当者名: ${targetNames.size}件`);
      console.log(`  ★ 名簿にあるが目標が無い: ${noTarget.length}件`);
      console.log(`  ★ 目標にあるが名簿に無い（表記ゆれの疑い）: ${noRoster.length}件`);
      if (noRoster.length > 0) {
        console.log(
          `     例: ${noRoster.slice(0, 10).map((n) => maskName(n, args.showNames)).join(", ")}`,
        );
      }
    }
  }

  console.log("\n完了（書き込みは行っていません）");
}

main().catch((e) => {
  console.error(`失敗: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
