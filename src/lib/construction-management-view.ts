/**
 * 施工管理タブの表示ロジック（画面から切り出したもの）。
 *
 * このプロジェクトには DOM テストの環境が無い（node のみ）ため、
 * 絞り込み・集計・並び順・状態の判定はここに置いてテストする。
 * 画面（construction-management-panel.tsx）は、ここの結果を描くだけにする。
 *
 * ⚠ ここは画面から読み込まれる。サーバー専用の部品は import しないこと
 *    （型だけは import type で読み込んでよい。実行時には消える）。
 */
import type {
  ConstructionManagementCounts,
  ConstructionManagementEvent,
  ConstructionManagementEventKind,
  ConstructionManagementPayload,
} from "@/lib/construction-management";

export type {
  ConstructionManagementCounts,
  ConstructionManagementEvent,
  ConstructionManagementEventKind,
  ConstructionManagementPayload,
};

/** 支店フィルターの「全支店」。支店名と重ならない値にしてある */
export const ALL_BRANCHES = "__all__";

/** 予定一覧・カレンダーのラベルの並び順（設置 → 施工 → 解体） */
export const KIND_ORDER: readonly ConstructionManagementEventKind[] = [
  "scaffoldInstall",
  "construction",
  "scaffoldRemoval",
];

/**
 * 区分ごとの表示。色だけで判断させないよう、必ず文字ラベルと組で使う。
 */
export const KIND_META: Record<
  ConstructionManagementEventKind,
  { label: string; shortLabel: string; color: string }
> = {
  scaffoldInstall: { label: "足場設置", shortLabel: "設置", color: "#2563EB" },
  scaffoldRemoval: { label: "足場解体", shortLabel: "解体", color: "#EA580C" },
  construction: { label: "施工予定", shortLabel: "施工", color: "#16A34A" },
};

export type KindSelection = ReadonlySet<ConstructionManagementEventKind>;

export const ALL_KINDS: KindSelection = new Set(KIND_ORDER);

/**
 * 支店フィルターの初期値。
 * 本人の勤務場所が一覧にあればそれ、無ければ「全支店」。
 */
export function initialBranchSelection(
  payload: Pick<ConstructionManagementPayload, "branches" | "selfWorkplace">,
): string {
  const self = payload.selfWorkplace?.trim();
  if (self && payload.branches.includes(self)) return self;
  return ALL_BRANCHES;
}

/**
 * 選択中の支店が新しい月の一覧に無ければ「全支店」に戻す。
 * （「その他」はその月に該当が無ければ一覧から消えるため）
 */
export function keepBranchSelection(
  selected: string,
  branches: readonly string[],
): string {
  if (selected === ALL_BRANCHES) return selected;
  return branches.includes(selected) ? selected : ALL_BRANCHES;
}

/**
 * 支店と区分で絞る。
 *
 * 支店は AP か CL のどちらかの支店が一致すれば含める（API の branches は
 * 両者の和集合）。「その他」も1つの支店名として同じように扱う。
 *
 * ⚠ AP と CL の支店が違う案件は両方の支店に計上される。
 *    支店ごとの件数を足しても全体の件数とは一致しない。
 */
export function filterConstructionEvents(
  events: readonly ConstructionManagementEvent[],
  branch: string,
  kinds: KindSelection,
): ConstructionManagementEvent[] {
  return events.filter(
    (e) =>
      kinds.has(e.kind) &&
      (branch === ALL_BRANCHES || e.branches.includes(branch)),
  );
}

/**
 * 月間集計カードの件数。絞り込み後の予定から数える。
 *
 * 全支店・全区分のときは API の counts と同じ値になる。
 * 区分を OFF にした区分は null（カードは淡色で「—」を出す）。
 *
 * ⚠ AP と CL の支店が違う案件は両方の支店に計上される。
 *    支店ごとの件数を足しても全体の件数とは一致しない。
 */
export function countConstructionEvents(
  filtered: readonly ConstructionManagementEvent[],
  kinds: KindSelection,
): Record<ConstructionManagementEventKind, number | null> {
  const counts: Record<ConstructionManagementEventKind, number | null> = {
    scaffoldInstall: kinds.has("scaffoldInstall") ? 0 : null,
    scaffoldRemoval: kinds.has("scaffoldRemoval") ? 0 : null,
    construction: kinds.has("construction") ? 0 : null,
  };
  for (const e of filtered) {
    const n = counts[e.kind];
    if (n !== null) counts[e.kind] = n + 1;
  }
  return counts;
}

export type DayKindSummary = {
  kind: ConstructionManagementEventKind;
  count: number;
};

/**
 * カレンダーのマスに出すラベル。同じ日・同じ区分は件数でまとめる
 * （「設置 3」）。マスにお客様名は出さない。並びは設置 → 施工 → 解体。
 */
export function summarizeEventsByDay(
  events: readonly ConstructionManagementEvent[],
): Map<string, DayKindSummary[]> {
  const counts = new Map<
    string,
    Map<ConstructionManagementEventKind, number>
  >();
  for (const e of events) {
    let byKind = counts.get(e.dayKey);
    if (!byKind) {
      byKind = new Map();
      counts.set(e.dayKey, byKind);
    }
    byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  }
  const out = new Map<string, DayKindSummary[]>();
  for (const [dayKey, byKind] of counts) {
    out.set(
      dayKey,
      KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => ({
        kind,
        count: byKind.get(kind)!,
      })),
    );
  }
  return out;
}

/**
 * 選択日の予定。省略せず全件を返す。
 * 並びは区分（設置 → 施工 → 解体）、同じ区分の中は API の順のまま。
 */
export function eventsOfDay(
  events: readonly ConstructionManagementEvent[],
  dayKey: string | null,
): ConstructionManagementEvent[] {
  if (!dayKey) return [];
  const rank = (k: ConstructionManagementEventKind) => KIND_ORDER.indexOf(k);
  return events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.dayKey === dayKey)
    .sort((a, b) => rank(a.e.kind) - rank(b.e.kind) || a.i - b.i)
    .map(({ e }) => e);
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** YYYY-MM-DD → 曜日（0=日）。暦の計算だけで、時刻・タイムゾーンは使わない */
function weekdayOf(dayKey: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

/** 「10月23日（金）」。読めなければ空文字 */
export function formatDayHeading(dayKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  const w = weekdayOf(dayKey);
  if (!m || w === null) return "";
  return `${Number(m[2])}月${Number(m[3])}日（${WEEKDAYS[w]}）`;
}

/** 詳細表示の日付。未登録（null・空）は「未定」 */
export function formatDetailDate(dayKey: string | null | undefined): string {
  const s = dayKey?.trim();
  if (!s) return "未定";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const w = weekdayOf(s);
  if (!m || w === null) return "未定";
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日（${WEEKDAYS[w]}）`;
}

export type MonthGridCell = { dayKey: string; inMonth: boolean; weekday: number };

/** 日曜始まり・7列のマス（前後の月で埋めて週単位にそろえる） */
export function buildSundayStartMonthGrid(
  year: number,
  month: number,
): MonthGridCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  const cells: MonthGridCell[] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(Date.UTC(year, month - 1, 1 - lead + i));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    cells.push({
      dayKey: key,
      inMonth: d.getUTCMonth() === month - 1,
      weekday: d.getUTCDay(),
    });
  }
  return cells;
}

/** 前月・翌月 */
export function shiftYearMonth(
  ym: { year: number; month: number },
  delta: number,
): { year: number; month: number } {
  const idx = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/**
 * 画面の状態。「取得に失敗した」と「予定が無い」を必ず分ける。
 *
 *   loading  初回の取得中（まだ何も無い）
 *   error    取得に失敗した（エラー文言と再試行ボタンを出す）
 *   ready    取得できた（その月・その日に予定が0件でもこれ。
 *            0件なら「予定はありません」を出す）
 *
 * 失敗したときに以前の月の data が残っていても、error を優先する
 * （古いデータを「予定」として見せない）。
 * 月を切り替えた直後は前の月の data が残る（SWR の keepPreviousData）ので、
 * data の年月が表示中の月と違えば loading とする。
 */
export type ConstructionManagementViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; payload: ConstructionManagementPayload };

export function resolveConstructionManagementViewState(input: {
  data: ConstructionManagementPayload | undefined;
  error: unknown;
  ym: { year: number; month: number };
}): ConstructionManagementViewState {
  if (input.error) {
    const msg =
      input.error instanceof Error && input.error.message
        ? input.error.message
        : "施工管理のデータ取得に失敗しました。";
    return { kind: "error", message: msg };
  }
  const d = input.data;
  if (!d || d.year !== input.ym.year || d.month !== input.ym.month) {
    return { kind: "loading" };
  }
  return { kind: "ready", payload: d };
}

/**
 * デバッグ用の要点（?cmDebug=1 のときだけコンソールに出す）。
 * 件数・真偽値・相関IDだけにして、氏名・T番号 は入れない。
 */
export function constructionManagementDebugSummary(
  state: ConstructionManagementViewState,
  ym: { year: number; month: number },
): Record<string, unknown> {
  if (state.kind !== "ready") {
    return { year: ym.year, month: ym.month, state: state.kind };
  }
  const p = state.payload;
  return {
    year: ym.year,
    month: ym.month,
    state: "ready",
    correlationId: p.correlationId,
    events: p.events.length,
    counts: p.counts,
    branches: p.branches.length,
    hasOtherBranch: p.branches.includes("その他"),
    hasSelfWorkplace: p.selfWorkplace !== null,
    duplicateTNumberGroups: p.duplicateTNumberGroups,
    unmatchedConstruction: p.events.filter(
      (e) => e.kind === "construction" && !e.customerMatched,
    ).length,
  };
}
