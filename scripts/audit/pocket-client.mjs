/**
 * Phase 1b 調査スクリプト用の最小 @pocket クライアント（読み取り専用）。
 *
 * src/lib/atpocket.ts の挙動を意図的に再実装している：
 *  - GET は POST + X-HTTP-Method-Override: GET（@pocket の認証ヘッダは POST に紐づくため）
 *  - 429 は Retry-After に従って1度だけ待機・再試行
 * Next のランタイム（server-only）を持ち込まずに素の Node から実行できるようにするため、
 * src/lib を import せず独立させている。
 *
 * このファイルは書き込み API（POST /records, PUT, DELETE）を一切持たない。
 */

import { readFileSync, existsSync } from "node:fs";

const DEFAULT_AUTH_HEADER = "X-At-Pocket-API-Key";
const PAGE_LIMIT = 1000;

/** .env 形式のファイルを process.env に読み込む（既存の process.env を上書きしない） */
export function loadEnvFile(path) {
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

/** 環境変数のうち最初に値があるものを返す（値そのものは決してログしない） */
export function firstEnv(...names) {
  for (const name of names) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** どの環境変数からキーを採ったかだけを返す（値は返さない） */
export function firstEnvName(...names) {
  for (const name of names) {
    if (process.env[name]?.trim()) return name;
  }
  return undefined;
}

function baseUrl() {
  const domain = process.env.ATPOCKET_DOMAIN?.trim();
  if (!domain) throw new Error("ATPOCKET_DOMAIN が未設定です");
  const normalized = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${normalized}`;
}

function authHeaderName() {
  return process.env.ATPOCKET_AUTH_HEADER?.trim() || DEFAULT_AUTH_HEADER;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(headers, fallbackMs) {
  const ra = headers.get("retry-after");
  if (!ra) return fallbackMs;
  const sec = Number(ra);
  if (Number.isFinite(sec) && sec >= 0) return Math.min(sec * 1000, 120_000);
  const when = Date.parse(ra);
  if (!Number.isNaN(when)) {
    return Math.max(0, Math.min(when - Date.now(), 120_000));
  }
  return fallbackMs;
}

async function pocketGet(pathWithQuery, apiKey) {
  const url = `${baseUrl()}${pathWithQuery}`;
  const doFetch = () =>
    fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        [authHeaderName()]: apiKey,
        "X-HTTP-Method-Override": "GET",
      },
    });

  let res = await doFetch();
  if (res.status === 429) {
    const wait = retryAfterMs(res.headers, 100_000);
    await res.text();
    process.stderr.write(
      `  [429] レート上限。${Math.ceil(wait / 1000)} 秒待機して1度だけ再試行します…\n`,
    );
    await sleep(wait);
    res = await doFetch();
  }

  const text = await res.text();
  if (!res.ok) {
    // API キーの値は含まれない（@pocket 側の本文と status のみ）
    throw new Error(`@pocket ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

/** GET /api/apps/{appsId}/fields を正規化して返す */
export async function fetchAppFields(appsId, apiKey) {
  const json = await pocketGet(
    `/api/apps/${appsId}/fields?limit=1000&page=1`,
    apiKey,
  );
  return (json.fields ?? []).map((raw) => {
    const o = raw ?? {};
    const uniqueId = o.uniqueId ?? o.field_unique_id ?? o.fieldUniqueId;
    const caption = o.caption;
    return {
      uniqueId: typeof uniqueId === "string" ? uniqueId.trim() : "",
      caption: typeof caption === "string" ? caption.trim() : "",
    };
  });
}

/**
 * 一覧をページングで取得。ページごとに待機してレート上限を避ける。
 * onPage(rows, pageNumber) で進捗を通知する。
 */
export async function fetchAllRecords(
  appsId,
  apiKey,
  { fieldsCsv, maxPages = 20, pageDelayMs = 1200, onPage } = {},
) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      limit: String(PAGE_LIMIT),
      page: String(page),
    });
    if (fieldsCsv) params.set("fields", fieldsCsv);
    const json = await pocketGet(
      `/api/apps/${appsId}/records?${params.toString()}`,
      apiKey,
    );
    const rows = json.records ?? [];
    all.push(...rows);
    if (onPage) onPage(rows, page);
    if (rows.length < PAGE_LIMIT) break;
    if (page < maxPages) await sleep(pageDelayMs);
  }
  return all;
}

export function recordIdOf(row) {
  if (row?.recordId != null) return String(row.recordId);
  if (row?.uniqueId != null) return String(row.uniqueId);
  return "";
}

/** src/lib/staff-construction-availability.ts の pocketTableCellToPlainString と同等 */
export function toPlainString(raw) {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  if (Array.isArray(raw)) {
    return raw.map(toPlainString).filter(Boolean).join(" ");
  }
  if (typeof raw === "object") {
    const o = raw;
    if (typeof o.value === "string") return o.value.trim();
    if (typeof o.value === "number" || typeof o.value === "boolean") {
      return String(o.value).trim();
    }
    if (Array.isArray(o.value)) return toPlainString(o.value);
    for (const k of ["label", "text", "displayValue", "caption"]) {
      if (typeof o[k] === "string") return o[k].trim();
    }
  }
  return String(raw).trim();
}

/** src/lib/calendar-kojo.ts の pickRecordValueByFieldAliases と同等（hyphen/underscore 揺れ吸収） */
export function pickFieldValue(recObj, fieldId) {
  const k = fieldId?.trim();
  if (!k || !recObj) return undefined;
  const candidates = new Set([k]);
  const dm = /^field-(\d+)$/i.exec(k);
  if (dm) {
    candidates.add(`field_${dm[1]}`);
    candidates.add(`field-${dm[1]}`);
  }
  const um = /^field_(\d+)$/i.exec(k);
  if (um) {
    candidates.add(`field-${um[1]}`);
    candidates.add(`field_${um[1]}`);
  }
  for (const c of candidates) {
    if (recObj[c] !== undefined) return recObj[c];
  }
  return undefined;
}

export function readField(recObj, fieldId) {
  return toPlainString(pickFieldValue(recObj, fieldId));
}

/** src/lib/customer-info-form/pt-transfer.ts の normApClStaffName と同一 */
export function normStaffName(raw) {
  return (raw ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * 空白を完全に落とした照合キー。
 * アプリ本体は使っていない（＝本体は「田中 孝明」と「田中孝明」を別人として扱う）。
 * この調査で「表記ゆれの疑い」を洗い出すためだけに使う。
 */
export function normStaffNameLoose(raw) {
  return normStaffName(raw).replace(/\s+/g, "");
}

/** src/lib/staff-construction-availability.ts の collectStatusCandidateStrings と同等 */
function collectStatusCandidates(raw, out) {
  if (raw === undefined || raw === null) return;
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    const t = String(raw).trim();
    if (t) out.push(t);
    return;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) collectStatusCandidates(item, out);
    return;
  }
  if (typeof raw === "object") {
    for (const key of ["label", "text", "displayValue", "caption", "name", "value"]) {
      const v = raw[key];
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        const t = String(v).trim();
        if (t) out.push(t);
      } else if (v != null) {
        collectStatusCandidates(v, out);
      }
    }
  }
}

/**
 * 選択肢列の表示用テキスト。
 * @pocket のラジオは {value: 選択肢ID, label: "稼働"} を返すことがあり、
 * toPlainString だと value（ID）を拾ってしまうため、label 系を優先する。
 */
export function readChoiceLabel(recObj, fieldId) {
  const raw = pickFieldValue(recObj, fieldId);
  const candidates = [];
  collectStatusCandidates(raw, candidates);
  // 先頭は label / text / displayValue / caption / name の順で拾われている
  return candidates[0] ?? toPlainString(raw);
}

/** src/lib/staff-construction-availability.ts の staffConstructionAvailabilityIsActive と同等 */
export function availabilityIsActive(raw, activeLabel) {
  const want = (activeLabel || "稼働").normalize("NFKC").trim();
  if (!want) return false;

  const candidates = [];
  collectStatusCandidates(raw, candidates);
  const plain = toPlainString(raw);
  if (plain) candidates.push(plain);

  const normalized = [
    ...new Set(candidates.map((c) => c.normalize("NFKC").trim()).filter(Boolean)),
  ];
  if (normalized.length === 0) return false;

  if (normalized.some((n) => n.includes("非") && n.includes(want))) return false;
  if (normalized.some((n) => n === want)) return true;
  if (want === "稼働") {
    return normalized.some(
      (n) => n.includes("稼働") && !n.includes("非稼働") && !n.includes("非 稼働"),
    );
  }
  return normalized.some((n) => n.includes(want));
}

/** src/lib/calendar-kojo.ts の resolveConfiguredFieldToSchemaUniqueId と同等 */
export function resolveConfiguredFieldId(configuredId, fields) {
  const id = configuredId?.trim();
  if (!id) return null;
  const schemaIds = new Set(fields.map((f) => f.uniqueId).filter(Boolean));
  if (schemaIds.has(id)) return id;
  const m = /^field[-_](\d+)$/i.exec(id);
  if (m) {
    for (const candidate of [`field-${m[1]}`, `field_${m[1]}`]) {
      if (schemaIds.has(candidate)) return candidate;
    }
  }
  return null;
}

/** 見出し（caption）の完全一致でフィールドを解決 */
export function fieldIdByCaption(fields, ...captions) {
  for (const caption of captions) {
    const target = caption.normalize("NFKC").trim().toLowerCase();
    for (const f of fields) {
      const cap = f.caption ? f.caption.normalize("NFKC").trim().toLowerCase() : "";
      if (cap && cap === target && f.uniqueId) return f.uniqueId;
    }
  }
  return null;
}

/** 環境変数の明示指定 → 見出し一致 の順でフィールドを解決 */
export function resolveFieldIdWithEnv(envNames, captions, fields) {
  for (const name of envNames) {
    const raw = process.env[name]?.trim();
    if (!raw) continue;
    const id = resolveConfiguredFieldId(raw, fields);
    if (id) return { fieldId: id, source: name };
  }
  const byCaption = fieldIdByCaption(fields, ...captions);
  if (byCaption) return { fieldId: byCaption, source: `caption:${captions[0]}` };
  return { fieldId: null, source: null };
}

export function toCsv(headerRow, rows) {
  const esc = (v) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headerRow.map(esc).join(",")];
  for (const r of rows) lines.push(r.map(esc).join(","));
  // Excel が UTF-8 と判定できるよう BOM を付ける
  return `﻿${lines.join("\r\n")}\r\n`;
}
