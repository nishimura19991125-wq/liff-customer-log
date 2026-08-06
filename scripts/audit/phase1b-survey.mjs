#!/usr/bin/env node
/**
 * Phase 1b 事前調査（読み取り専用）
 *
 * B-4-0（移行前の実態調査）と B-2-4（既存 bind の判断材料）、
 * B-2-3（退職者に LINE userId が残っている件数）をまとめて出力する。
 *
 * このスクリプトは @pocket に対して GET しか行わない。
 * 書き込み API は import している pocket-client.mjs にも存在しない。
 *
 * ── 実行方法 ──────────────────────────────────────────────
 *   node scripts/audit/phase1b-survey.mjs --env-path .env.local
 *
 * ⚠ フラグ名は --env-path。--env-file は Node 20.6+ の**組み込みオプション**と衝突し、
 *   スクリプトへ渡る前に Node 自身が横取りする（ファイルが無いと
 *   「node.exe: .env.local: not found」で即終了する）。
 *
 * 既定では「件数サマリのみ」を標準出力に出す（個人情報を出力しない）。
 * 明細が必要なときだけ --out-dir を付ける：
 *   node scripts/audit/phase1b-survey.mjs --env-path .env.local --out-dir ../phase1b-audit
 *
 * ── 主なオプション ────────────────────────────────────────
 *   --env-path <path>     .env 形式のファイルを読み込む（既定: .env.local → .env）
 *                         ※ --env-file は Node の組み込みフラグと衝突するため非推奨
 *   --out-dir <dir>       CSV 明細の出力先。★個人情報を含むためリポジトリ外を推奨★
 *   --sections a,b,c      実行するセクション（既定: 全部）
 *                         staff / customer / calendar
 *   --max-pages N         1アプリあたりの最大ページ数（既定 20 = 最大 20,000 件）
 *   --page-delay-ms N     ページ間の待機ミリ秒（既定 1200）
 *   --help
 *
 * ── @pocket レート上限について ────────────────────────────
 * 同一 API キーで 100 秒あたりの上限がある。このスクリプトは本番の LIFF アプリと
 * 同じキーを使うため、実行中は業務側が 429 を受ける可能性がある。
 * 業務時間外に実行するか、--page-delay-ms を大きめにすること。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  availabilityIsActive,
  fetchAllRecords,
  fetchAppFields,
  firstEnv,
  firstEnvName,
  loadEnvFile,
  normStaffName,
  normStaffNameLoose,
  pickFieldValue,
  readChoiceLabel,
  readField,
  recordIdOf,
  resolveConfiguredFieldId,
  resolveFieldIdWithEnv,
  toCsv,
} from "./pocket-client.mjs";

// ─────────────────────────────────────────────────────────── CLI

function parseArgs(argv) {
  const out = {
    envFile: null,
    outDir: null,
    sections: ["staff", "customer", "calendar"],
    maxPages: 20,
    pageDelayMs: 1200,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--env-path" || a === "--env-file") out.envFile = next();
    else if (a === "--out-dir") out.outDir = next();
    else if (a === "--sections") {
      out.sections = next()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--max-pages") out.maxPages = Number(next());
    else if (a === "--page-delay-ms") out.pageDelayMs = Number(next());
    else {
      throw new Error(`不明なオプション: ${a}`);
    }
  }
  if (!Number.isFinite(out.maxPages) || out.maxPages < 1) out.maxPages = 20;
  if (!Number.isFinite(out.pageDelayMs) || out.pageDelayMs < 0) {
    out.pageDelayMs = 1200;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(
    `${new URL(import.meta.url).pathname}\n  --help を参照（ファイル冒頭のコメントに全オプションの説明があります）\n`,
  );
  process.exit(0);
}

const loaded =
  loadEnvFile(args.envFile) ||
  (!args.envFile && (loadEnvFile(".env.local") || loadEnvFile(".env")));

// ─────────────────────────────────────────────────────── 出力ユーティリティ

const log = (s = "") => process.stdout.write(`${s}\n`);
const warnings = [];
const writtenFiles = [];

function h1(title) {
  log("");
  log(`══ ${title} ${"═".repeat(Math.max(0, 62 - title.length))}`);
}

function h2(title) {
  log("");
  log(`── ${title}`);
}

function writeCsv(name, header, rows) {
  if (!args.outDir) return;
  mkdirSync(args.outDir, { recursive: true });
  const file = path.join(args.outDir, name);
  writeFileSync(file, toCsv(header, rows), "utf8");
  writtenFiles.push(`${file}（${rows.length} 行）`);
}

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} が未設定です`);
  return v;
}

// ─────────────────────────────────────────────────── 名簿（全セクション共通）

/** 名簿の読み取りキー。src/lib/atpocket.ts staffReadListAuths() の優先順に合わせる */
function staffReadKeyEnvName() {
  return firstEnvName(
    "ATPOCKET_API_KEY",
    "ATPOCKET_API_KEY_1",
    "STAFF_READ_ATPOCKET_API_KEY",
    "STAFF_READ_ATPOCKET_API_KEY_1",
  );
}

async function loadStaffRoster() {
  const appId = requireEnv("STAFF_APP_ID");
  const keyEnv = staffReadKeyEnvName();
  if (!keyEnv) {
    throw new Error(
      "スタッフ名簿の読み取りキーが未設定です（ATPOCKET_API_KEY / ATPOCKET_API_KEY_1 / STAFF_READ_ATPOCKET_API_KEY のいずれか）",
    );
  }
  const apiKey = process.env[keyEnv].trim();

  log(`  名簿アプリ: STAFF_APP_ID=${appId} / キー: ${keyEnv}`);
  const fields = await fetchAppFields(appId, apiKey);

  const nameFieldId = resolveConfiguredFieldId(
    requireEnv("STAFF_NAME_FIELD_ID"),
    fields,
  );
  if (!nameFieldId) {
    throw new Error(
      "STAFF_NAME_FIELD_ID が名簿のフィールド定義と一致しません（列の識別名を確認してください）",
    );
  }

  const line1 = resolveConfiguredFieldId(
    firstEnv("STAFF_LINE_USER_ID_1_FIELD_ID", "STAFF_LINE_USER_ID_FIELD_ID") ?? "",
    fields,
  );
  const line2 = resolveConfiguredFieldId(
    firstEnv("STAFF_LINE_USER_ID_2_FIELD_ID", "STAFF_LINE_USER_ID_FIELD_ID_2") ?? "",
    fields,
  );
  const importKey = resolveConfiguredFieldId(
    process.env.STAFF_IMPORT_KEY_FIELD_ID ?? "",
    fields,
  );
  // 監査ログの「実行者」に使う（A-2）
  const emailField = resolveFieldIdWithEnv(
    ["STAFF_EMAIL_FIELD_ID"],
    ["メールアドレス", "メール", "Email", "E-mail", "会社メール"],
    fields,
  );
  const availability = resolveFieldIdWithEnv(
    ["STAFF_AVAILABILITY_FIELD_ID"],
    ["稼働状況", "稼働 状況"],
    fields,
  );
  const department = resolveFieldIdWithEnv(
    ["STAFF_DEPARTMENT_FIELD_ID"],
    ["部署", "事業部", "所属", "所属部署", "部門"],
    fields,
  );

  if (!line1 && !line2) {
    warnings.push(
      "名簿の LINE userId 列を解決できませんでした（STAFF_LINE_USER_ID_1_FIELD_ID / _2_FIELD_ID）。bind 現況セクションは不完全です。",
    );
  }
  if (!importKey) {
    warnings.push(
      "STAFF_IMPORT_KEY_FIELD_ID（社員ID）を解決できませんでした。B-4 の移行キーが特定できないため、この設定は移行前に必須です。",
    );
  }
  if (!availability.fieldId) {
    warnings.push(
      "名簿の「稼働状況」列を解決できませんでした。退職者判定のセクションはスキップされます。",
    );
  }
  if (!emailField.fieldId) {
    warnings.push(
      "名簿のメールアドレス列を解決できませんでした（STAFF_EMAIL_FIELD_ID）。監査ログの「実行者」が全員 liff:<社員ID> になります。",
    );
  }

  const rows = await fetchAllRecords(appId, apiKey, {
    maxPages: args.maxPages,
    pageDelayMs: args.pageDelayMs,
    onPage: (r, p) => log(`    名簿 page ${p}: ${r.length} 件`),
  });

  const activeLabel = (
    firstEnv(
      "STAFF_AVAILABILITY_ACTIVE_LABEL",
      "STAFF_CONSTRUCTION_AVAILABILITY_ACTIVE_LABEL",
    ) ?? "稼働"
  )
    .normalize("NFKC")
    .trim();

  const staff = rows
    .map((row) => {
      const rec = row.record ?? {};
      const name = readField(rec, nameFieldId);
      // 稼働状況は選択肢列のことがあるため、value(ID) ではなく label を読む
      const availabilityLabel = availability.fieldId
        ? readChoiceLabel(rec, availability.fieldId)
        : "";
      return {
        recordId: recordIdOf(row),
        name,
        norm: normStaffName(name),
        normLoose: normStaffNameLoose(name),
        staffCode: importKey ? readField(rec, importKey) : "",
        email: emailField.fieldId ? readField(rec, emailField.fieldId) : "",
        line1: line1 ? readField(rec, line1) : "",
        line2: line2 ? readField(rec, line2) : "",
        availability: availabilityLabel,
        isActive: availability.fieldId
          ? availabilityIsActive(
              pickFieldValue(rec, availability.fieldId),
              activeLabel,
            )
          : true,
        department: department.fieldId ? readField(rec, department.fieldId) : "",
      };
    })
    .filter((s) => s.recordId && s.name);

  return {
    staff,
    activeLabel,
    resolved: {
      nameFieldId,
      line1,
      line2,
      importKey,
      availability: availability.fieldId,
      availabilitySource: availability.source,
      department: department.fieldId,
      email: emailField.fieldId,
      emailSource: emailField.source,
    },
  };
}

// ───────────────────────────────────────── セクション: 名簿（B-4-0 #1 / B-2-3 / B-2-4）

function reportStaff(roster) {
  const { staff, activeLabel } = roster;

  h1("セクション 1: スタッフ名簿");
  log(`  総件数: ${staff.length}`);
  log(`  稼働ラベル: 「${activeLabel}」`);
  log(`  稼働中: ${staff.filter((s) => s.isActive).length}`);
  log(`  稼働外: ${staff.filter((s) => !s.isActive).length}`);

  // ── B-4-0 #1: 同姓同名 ──────────────────────────────
  h2("1-1. 同姓同名（B-4-0 #1）※ normApClStaffName 適用後に重複する氏名");
  const byNorm = new Map();
  for (const s of staff) {
    if (!s.norm) continue;
    const list = byNorm.get(s.norm) ?? [];
    list.push(s);
    byNorm.set(s.norm, list);
  }
  const collisions = [...byNorm.entries()].filter(([, v]) => v.length > 1);
  log(`  重複している氏名: ${collisions.length} 件`);
  log(
    `  影響を受けるレコード: ${collisions.reduce((n, [, v]) => n + v.length, 0)} 件`,
  );
  if (collisions.length > 0) {
    log("");
    log("  ★ 同姓同名が存在します。氏名突合による認可・絞り込みは既に破綻しています。");
    for (const [norm, list] of collisions) {
      const detail = list
        .map(
          (s) =>
            `recordId=${s.recordId} 社員ID=${s.staffCode || "(空)"} 稼働=${s.availability || "(空)"} 部署=${s.department || "(空)"}`,
        )
        .join(" / ");
      log(`    ・「${norm}」× ${list.length}: ${detail}`);
    }
  }
  writeCsv(
    "01_staff_name_collisions.csv",
    ["正規化氏名", "件数", "recordId", "氏名(生値)", "社員ID", "稼働状況", "部署"],
    collisions.flatMap(([norm, list]) =>
      list.map((s) => [
        norm,
        list.length,
        s.recordId,
        s.name,
        s.staffCode,
        s.availability,
        s.department,
      ]),
    ),
  );

  // ── 表記ゆれ（空白差のみ）─────────────────────────────
  h2("1-1b. 空白の有無だけが違う氏名（表記ゆれ・別レコード扱いになっている）");
  const byLoose = new Map();
  for (const s of staff) {
    if (!s.normLoose) continue;
    const list = byLoose.get(s.normLoose) ?? [];
    list.push(s);
    byLoose.set(s.normLoose, list);
  }
  const looseOnly = [...byLoose.entries()].filter(
    ([, v]) => v.length > 1 && new Set(v.map((s) => s.norm)).size > 1,
  );
  log(`  該当: ${looseOnly.length} 組`);
  if (looseOnly.length > 0) {
    log(
      "  ※ アプリ本体（normApClStaffName）は空白を残すため、これらは今も別人として扱われています。",
    );
    for (const [, list] of looseOnly) {
      log(`    ・${list.map((s) => `「${s.name}」(recordId=${s.recordId})`).join(" / ")}`);
    }
  }

  // ── B-4 前提: 社員IDの充足率 ─────────────────────────
  h2("1-2. 社員ID（STAFF_IMPORT_KEY_FIELD_ID）の充足率 ※ B-4 の移行キー");
  if (!roster.resolved.importKey) {
    log("  ※ 社員ID列を解決できないため計測できません。");
  } else {
    const withCode = staff.filter((s) => s.staffCode);
    const pct = staff.length
      ? ((withCode.length / staff.length) * 100).toFixed(1)
      : "0.0";
    log(`  社員IDあり: ${withCode.length} / ${staff.length}（${pct}%）`);
    const dupCode = new Map();
    for (const s of withCode) {
      const list = dupCode.get(s.staffCode) ?? [];
      list.push(s);
      dupCode.set(s.staffCode, list);
    }
    const dupes = [...dupCode.entries()].filter(([, v]) => v.length > 1);
    log(`  社員IDの重複: ${dupes.length} 件`);
    if (dupes.length > 0) {
      log("  ★ 社員IDが重複しています。移行キーとして使う前に名簿側の是正が必要です。");
      for (const [code, list] of dupes) {
        log(`    ・${code} × ${list.length}: ${list.map((s) => s.name).join(" / ")}`);
      }
    }
    writeCsv(
      "02_staff_missing_code.csv",
      ["recordId", "氏名", "稼働状況", "部署"],
      staff
        .filter((s) => !s.staffCode)
        .map((s) => [s.recordId, s.name, s.availability, s.department]),
    );
  }

  // ── A-2: 監査ログ「実行者」用メールアドレスの充足率 ──────
  h2("1-2b. メールアドレスの充足率（監査ログの「実行者」に使う）");
  if (!roster.resolved.email) {
    log("  ※ メールアドレス列を解決できないため計測できません。");
    log("     STAFF_EMAIL_FIELD_ID を設定してください。");
    log("     未設定のままだと全員 liff:<社員ID> で記録されます。");
  } else {
    log(`  解決した列: ${roster.resolved.email}（${roster.resolved.emailSource}）`);
    const withEmail = staff.filter((s) => s.email);
    const pct = staff.length
      ? ((withEmail.length / staff.length) * 100).toFixed(1)
      : "0.0";
    log(`  メールあり: ${withEmail.length} / ${staff.length}（${pct}%）`);

    // 稼働中の未登録者だけが実害（退職者は LIFF を使わない）
    const missingActive = staff.filter((s) => !s.email && s.isActive);
    const missingInactive = staff.filter((s) => !s.email && !s.isActive);
    log(`  未登録（稼働中）: ${missingActive.length} 件 ← 実害あり`);
    log(`  未登録（稼働外）: ${missingInactive.length} 件`);

    if (missingActive.length > 0) {
      log("");
      log("  ★ この人たちの操作は「liff:<社員ID>」で記録されます:");
      for (const s of missingActive) {
        log(
          `    ・${s.name}（recordId=${s.recordId} 社員ID=${s.staffCode || "(空)"} 部署=${s.department || "(空)"}）`,
        );
      }
      const noCode = missingActive.filter((s) => !s.staffCode);
      if (noCode.length > 0) {
        log("");
        log(
          `  ★★ うち ${noCode.length} 件はメールも社員IDも無く「liff:unknown」になります: ${noCode
            .map((s) => s.name)
            .join(" / ")}`,
        );
      }
    }

    writeCsv(
      "07_staff_missing_email.csv",
      ["recordId", "氏名", "社員ID", "部署", "稼働状況", "稼働中", "記録される実行者"],
      staff
        .filter((s) => !s.email)
        .map((s) => [
          s.recordId,
          s.name,
          s.staffCode,
          s.department,
          s.availability,
          s.isActive ? "はい" : "いいえ",
          s.staffCode ? `liff:${s.staffCode}` : "liff:unknown",
        ]),
    );
    log("  ※ CSV にメールアドレスの値そのものは出力していません（有無のみ）。");
  }

  // ── B-2-4 判断材料: bind 現況 ─────────────────────────
  h2("1-3. bind 現況（B-2-4 の判断材料）");
  const both = staff.filter((s) => s.line1 && s.line2);
  const onlyOne = staff.filter((s) => (s.line1 ? 1 : 0) + (s.line2 ? 1 : 0) === 1);
  const none = staff.filter((s) => !s.line1 && !s.line2);
  const slot2Only = staff.filter((s) => !s.line1 && s.line2);
  log(`  LINE 枠 2つとも使用: ${both.length}`);
  log(`  LINE 枠 1つのみ使用: ${onlyOne.length}`);
  log(`  LINE 未紐付け:       ${none.length}`);
  log(`  ★ LINE①が空で②のみ使用: ${slot2Only.length}（想定外の状態。要目視確認）`);

  const allLineIds = [];
  for (const s of staff) {
    if (s.line1) allLineIds.push({ id: s.line1, staff: s, slot: "LINE①" });
    if (s.line2) allLineIds.push({ id: s.line2, staff: s, slot: "LINE②" });
  }
  const byLineId = new Map();
  for (const e of allLineIds) {
    const list = byLineId.get(e.id) ?? [];
    list.push(e);
    byLineId.set(e.id, list);
  }
  const crossBound = [...byLineId.entries()].filter(([, v]) => v.length > 1);
  log(`  同一 LINE userId が複数レコードに存在: ${crossBound.length} 件`);
  if (crossBound.length > 0) {
    log("  ★ bind/route.ts の重複チェックを潜り抜けた紐付けです。最優先で確認してください。");
    for (const [, list] of crossBound) {
      log(
        `    ・${list.map((e) => `${e.staff.name}(${e.slot}, recordId=${e.staff.recordId})`).join(" ⇔ ")}`,
      );
    }
  }
  writeCsv(
    "03_staff_bindings.csv",
    [
      "recordId",
      "氏名",
      "社員ID",
      "部署",
      "稼働状況",
      "稼働中",
      "LINE①使用",
      "LINE②使用",
      "枠使用数",
    ],
    staff.map((s) => [
      s.recordId,
      s.name,
      s.staffCode,
      s.department,
      s.availability,
      s.isActive ? "はい" : "いいえ",
      s.line1 ? "あり" : "",
      s.line2 ? "あり" : "",
      (s.line1 ? 1 : 0) + (s.line2 ? 1 : 0),
    ]),
  );
  log("  ※ CSV には LINE userId の値そのものは出力していません（有無のみ）。");

  // ── B-2-3: 稼働外なのに LINE が残っている ───────────────
  h2("1-4. 稼働外レコードに LINE userId が残存（B-2-3 の枠解放運用）");
  if (!roster.resolved.availability) {
    log("  ※ 稼働状況列を解決できないためスキップしました。");
  } else {
    const stale = staff.filter((s) => !s.isActive && (s.line1 || s.line2));
    log(`  該当: ${stale.length} 件`);
    if (stale.length > 0) {
      log("  ★ 退職・休止扱いのレコードから LIFF に入れる状態です。事務所での枠クリアが必要です。");
      for (const s of stale) {
        log(
          `    ・${s.name}（recordId=${s.recordId} 稼働=${s.availability || "(空)"} 枠=${
            [s.line1 && "①", s.line2 && "②"].filter(Boolean).join("") || "-"
          }）`,
        );
      }
    }
    writeCsv(
      "04_staff_inactive_with_line.csv",
      ["recordId", "氏名", "社員ID", "稼働状況", "部署", "LINE①使用", "LINE②使用"],
      stale.map((s) => [
        s.recordId,
        s.name,
        s.staffCode,
        s.availability,
        s.department,
        s.line1 ? "あり" : "",
        s.line2 ? "あり" : "",
      ]),
    );
  }
}

// ───────────────────────── セクション: 担当者名の不一致（B-4-0 #2 / #3）

/**
 * 指定アプリの担当者系フィールドを走査し、名簿の氏名に一致しない値を集計する。
 */
async function reportAssigneeMismatch({
  label,
  appId,
  apiKey,
  keyEnvName,
  assigneeSpecs,
  labelFieldSpec,
  roster,
  csvPrefix,
}) {
  h1(`${label} の担当者名 突合`);
  log(`  アプリ: ${appId} / キー: ${keyEnvName}`);

  const fields = await fetchAppFields(appId, apiKey);
  const resolved = [];
  for (const spec of assigneeSpecs) {
    const r = resolveFieldIdWithEnv(spec.envNames, spec.captions, fields);
    if (!r.fieldId) {
      warnings.push(
        `${label}: 「${spec.label}」列を解決できませんでした（${spec.captions[0]} / ${spec.envNames.join(" or ")}）。この列は集計から除外しました。`,
      );
      continue;
    }
    resolved.push({ ...spec, fieldId: r.fieldId, source: r.source });
    log(`    ${spec.label} → ${r.fieldId}（${r.source}）`);
  }
  if (resolved.length === 0) {
    log("  解決できた担当者列がないため中止します。");
    return;
  }

  const labelField = labelFieldSpec
    ? resolveFieldIdWithEnv(
        labelFieldSpec.envNames,
        labelFieldSpec.captions,
        fields,
      ).fieldId
    : null;

  const fieldsCsv = [...resolved.map((r) => r.fieldId), labelField]
    .filter(Boolean)
    .join(",");

  const rows = await fetchAllRecords(appId, apiKey, {
    fieldsCsv,
    maxPages: args.maxPages,
    pageDelayMs: args.pageDelayMs,
    onPage: (r, p) => log(`    ${label} page ${p}: ${r.length} 件`),
  });
  log(`  取得件数: ${rows.length}`);
  if (rows.length >= args.maxPages * 1000) {
    warnings.push(
      `${label}: --max-pages=${args.maxPages} の上限に達しました。全件を見ていない可能性があります。`,
    );
  }

  const known = new Set(roster.staff.map((s) => s.norm).filter(Boolean));
  const knownActive = new Set(
    roster.staff.filter((s) => s.isActive).map((s) => s.norm).filter(Boolean),
  );
  // 空白差だけで名簿に一致するか（＝機械的に直せる表記ゆれか）を見分ける
  const knownLoose = new Map();
  for (const s of roster.staff) {
    if (!s.normLoose) continue;
    if (!knownLoose.has(s.normLoose)) knownLoose.set(s.normLoose, []);
    knownLoose.get(s.normLoose).push(s);
  }

  const perColumn = new Map(
    resolved.map((r) => [
      r.label,
      { filled: 0, unknown: 0, whitespace: 0, ambiguous: 0, inactive: 0 },
    ]),
  );
  const unknownCounts = new Map(); // 完全に未知の値 → 件数
  const whitespaceCounts = new Map(); // 空白差のみの値 → 件数
  const detail = [];

  for (const row of rows) {
    const rec = row.record ?? {};
    const rid = recordIdOf(row);
    const key = labelField ? readField(rec, labelField) : "";
    for (const col of resolved) {
      const raw = readField(rec, col.fieldId);
      const norm = normStaffName(raw);
      if (!norm || norm === "-" || norm === "－") continue;
      const stats = perColumn.get(col.label);
      stats.filled++;

      if (known.has(norm)) {
        // 名簿に一致。ただし同姓同名なら「どちらの人か」は決まらない
        const loose = knownLoose.get(normStaffNameLoose(norm)) ?? [];
        const exact = loose.filter((s) => s.norm === norm);
        if (exact.length > 1) {
          stats.ambiguous++;
          detail.push([rid, key, col.label, raw, norm, "同姓同名で一意に決まらない"]);
        }
        if (!knownActive.has(norm)) {
          stats.inactive++;
          detail.push([rid, key, col.label, raw, norm, "名簿にあるが稼働外"]);
        }
        continue;
      }

      const loose = knownLoose.get(normStaffNameLoose(norm)) ?? [];
      if (loose.length === 1) {
        stats.whitespace++;
        whitespaceCounts.set(norm, (whitespaceCounts.get(norm) ?? 0) + 1);
        detail.push([
          rid,
          key,
          col.label,
          raw,
          norm,
          `空白差のみ（名簿では「${loose[0].name}」）`,
        ]);
      } else if (loose.length > 1) {
        stats.ambiguous++;
        detail.push([rid, key, col.label, raw, norm, "空白差で複数候補に一致"]);
      } else {
        stats.unknown++;
        unknownCounts.set(norm, (unknownCounts.get(norm) ?? 0) + 1);
        detail.push([rid, key, col.label, raw, norm, "名簿に該当なし"]);
      }
    }
  }

  h2("列ごとの集計");
  log("  （自動移行の可否: 空白差=自動で直せる / 該当なし・同姓同名=要手動確認）");
  for (const [colLabel, s] of perColumn) {
    const bad = s.unknown + s.ambiguous;
    const pct = s.filled ? ((bad / s.filled) * 100).toFixed(1) : "0.0";
    log(
      `  ${colLabel}: 値あり ${s.filled} / 名簿に該当なし ${s.unknown} / 空白差のみ ${s.whitespace} / 同姓同名等で不定 ${s.ambiguous} / 稼働外 ${s.inactive}`,
    );
    log(`      → 要手動確認: ${bad} 件（${pct}%）`);
  }

  h2("名簿に該当なし（出現回数の多い順・上位30）");
  const sortedUnknown = [...unknownCounts.entries()].sort((a, b) => b[1] - a[1]);
  const unknownTotal = [...unknownCounts.values()].reduce((a, b) => a + b, 0);
  log(`  異なり数: ${sortedUnknown.length} 種類 / 延べ ${unknownTotal} 件`);
  for (const [value, count] of sortedUnknown.slice(0, 30)) {
    log(`    ${String(count).padStart(5)} 件  「${value}」`);
  }
  if (sortedUnknown.length > 30) {
    log(`    …ほか ${sortedUnknown.length - 30} 種類`);
  }

  h2("空白差のみで名簿に一致（機械的に直せる表記ゆれ）");
  const sortedWs = [...whitespaceCounts.entries()].sort((a, b) => b[1] - a[1]);
  const wsTotal = [...whitespaceCounts.values()].reduce((a, b) => a + b, 0);
  log(`  異なり数: ${sortedWs.length} 種類 / 延べ ${wsTotal} 件`);
  for (const [value, count] of sortedWs.slice(0, 30)) {
    log(`    ${String(count).padStart(5)} 件  「${value}」`);
  }
  if (sortedWs.length > 30) log(`    …ほか ${sortedWs.length - 30} 種類`);

  writeCsv(
    `${csvPrefix}_unmatched_values.csv`,
    ["区分", "正規化値", "出現回数"],
    [
      ...sortedUnknown.map(([v, c]) => ["名簿に該当なし", v, c]),
      ...sortedWs.map(([v, c]) => ["空白差のみ", v, c]),
    ],
  );
  writeCsv(
    `${csvPrefix}_unmatched_records.csv`,
    ["recordId", "対象キー", "列", "生値", "正規化値", "区分"],
    detail,
  );
}

// ─────────────────────────────────────────────────────────── main

async function main() {
  log("Phase 1b 事前調査（読み取り専用）");
  log(`  env: ${loaded ? args.envFile ?? ".env.local / .env" : "（ファイルなし・process.env のみ）"}`);
  log(`  出力: ${args.outDir ? `${args.outDir}（CSV 明細あり）` : "サマリのみ（--out-dir で明細CSV）"}`);
  log(`  max-pages=${args.maxPages} page-delay=${args.pageDelayMs}ms`);

  h1("名簿の読み込み");
  const roster = await loadStaffRoster();
  log(`  読み込み完了: ${roster.staff.length} 件`);

  if (args.sections.includes("staff")) {
    reportStaff(roster);
  }

  if (args.sections.includes("customer")) {
    const appId = process.env.CUSTOMER_INFO_APP_ID?.trim();
    const keyEnv = firstEnvName(
      "CUSTOMER_INFO_ATPOCKET_API_KEY_LIST_1",
      "CUSTOMER_INFO_ATPOCKET_API_KEY_1",
      "CUSTOMER_INFO_ATPOCKET_API_KEY",
    );
    if (!appId || !keyEnv) {
      warnings.push(
        "お客様情報アプリ（CUSTOMER_INFO_APP_ID / 読み取りキー）が未設定のため B-4-0 #2 をスキップしました。",
      );
    } else {
      await reportAssigneeMismatch({
        label: "お客様情報",
        appId,
        apiKey: process.env[keyEnv].trim(),
        keyEnvName: keyEnv,
        roster,
        csvPrefix: "05_customer_info",
        labelFieldSpec: {
          envNames: ["CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID"],
          captions: ["T番号"],
        },
        assigneeSpecs: [
          {
            label: "AP担当者",
            envNames: ["CUSTOMER_INFO_FIELD_AP_STAFF"],
            captions: ["AP担当者"],
          },
          {
            label: "CL担当者",
            envNames: ["CUSTOMER_INFO_FIELD_CL_STAFF"],
            captions: ["CL担当者"],
          },
          {
            label: "案件作成者",
            envNames: ["CUSTOMER_INFO_CREATOR_FIELD_ID"],
            captions: ["案件作成者", "作成者", "登録者", "作成担当者", "登録担当者"],
          },
        ],
      });
    }
  }

  if (args.sections.includes("calendar")) {
    const appId = process.env.CALENDAR_APP_ID?.trim();
    const keyEnv = firstEnvName(
      "CALENDAR_ATPOCKET_API_KEY",
      "CALENDAR_ATPOCKET_API_KEY_2",
    );
    if (!appId || !keyEnv) {
      warnings.push(
        "工事カレンダーアプリ（CALENDAR_APP_ID / 読み取りキー）が未設定のため B-4-0 #3 をスキップしました。",
      );
    } else {
      await reportAssigneeMismatch({
        label: "工事カレンダー",
        appId,
        apiKey: process.env[keyEnv].trim(),
        keyEnvName: keyEnv,
        roster,
        csvPrefix: "06_calendar",
        labelFieldSpec: {
          envNames: ["CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID"],
          captions: ["T番号"],
        },
        assigneeSpecs: [
          {
            label: "工事対応者",
            envNames: [
              "CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID",
              "CALENDAR_EMPTY_FILL_CONSTRUCTION_REGISTRANT_FIELD_ID",
            ],
            captions: ["工事対応者", "工事登録者"],
          },
        ],
      });
    }
  }

  h1("まとめ");
  if (writtenFiles.length > 0) {
    log("  出力ファイル（★個人情報を含みます。共有・コミットしないこと★）:");
    for (const f of writtenFiles) log(`    ${f}`);
  } else {
    log("  明細CSVは出力していません（--out-dir で出力できます）。");
  }
  if (warnings.length > 0) {
    log("");
    log("  警告:");
    for (const w of warnings) log(`    ・${w}`);
  }
  log("");
}

main().catch((e) => {
  process.stderr.write(`\n[失敗] ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
