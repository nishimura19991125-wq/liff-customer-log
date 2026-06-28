/** テロップ用：日付（YYYY-MM-DD）＋ユーザー名のハッシュで日替わり固定のビジネス占い */

import { AP_BUSINESS_FORTUNE_LINES } from "@/lib/business-fortune-lines-ap";
import { CL_BUSINESS_FORTUNE_LINES } from "@/lib/business-fortune-lines-cl";
import { OFFICE_BUSINESS_FORTUNE_LINES } from "@/lib/business-fortune-lines-office";
import {
  resolveFortuneDivision,
  type FortuneDivision,
  type FortuneDivisionContext,
} from "@/lib/fortune-division";

export type DailyFortuneView = {
  dateLabel: string;
  whoLabel: string;
  headline: string;
  detailLine: string;
};

export type DailyFortuneBuildContext = FortuneDivisionContext;

type FortuneRank =
  | "超大吉"
  | "大吉"
  | "中吉"
  | "小吉"
  | "吉"
  | "凶"
  | "大凶";

const FORTUNE_RANKS: readonly FortuneRank[] = [
  "超大吉",
  "大吉",
  "中吉",
  "小吉",
  "吉",
  "凶",
  "大凶",
];

/** 等確率より凶・大凶の出方を抑える（合計 100） */
const FORTUNE_RANK_WEIGHTS: ReadonlyArray<{
  rank: FortuneRank;
  weight: number;
}> = [
  { rank: "超大吉", weight: 14 },
  { rank: "大吉", weight: 24 },
  { rank: "中吉", weight: 18 },
  { rank: "小吉", weight: 14 },
  { rank: "吉", weight: 22 },
  { rank: "凶", weight: 5 },
  { rank: "大凶", weight: 3 },
];

const CL_FALLBACK_LINES = CL_BUSINESS_FORTUNE_LINES;

const DIVISION_PRIMARY_LINES: Record<FortuneDivision, readonly string[]> = {
  cl: CL_BUSINESS_FORTUNE_LINES,
  ap: AP_BUSINESS_FORTUNE_LINES,
  office: OFFICE_BUSINESS_FORTUNE_LINES,
};

function filterLinesByRank(
  lines: readonly string[],
  rank: FortuneRank,
): readonly string[] {
  return lines.filter((line) => line.startsWith(`【${rank}】`));
}

function buildFortuneLinesByRank(
  division: FortuneDivision,
): Record<FortuneRank, readonly string[]> {
  const primary = DIVISION_PRIMARY_LINES[division];
  const result = {} as Record<FortuneRank, readonly string[]>;
  for (const rank of FORTUNE_RANKS) {
    const fromPrimary = filterLinesByRank(primary, rank);
    result[rank] =
      fromPrimary.length > 0
        ? fromPrimary
        : filterLinesByRank(CL_FALLBACK_LINES, rank);
  }
  return result;
}

const FORTUNE_LINES_BY_DIVISION: Record<
  FortuneDivision,
  Record<FortuneRank, readonly string[]>
> = {
  cl: buildFortuneLinesByRank("cl"),
  ap: buildFortuneLinesByRank("ap"),
  office: buildFortuneLinesByRank("office"),
};

function pickWeightedFortuneRank(seed: number): FortuneRank {
  const total = FORTUNE_RANK_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = seed % total;
  for (const entry of FORTUNE_RANK_WEIGHTS) {
    if (roll < entry.weight) return entry.rank;
    roll -= entry.weight;
  }
  return "吉";
}

function pickFortuneLineForRank(
  division: FortuneDivision,
  rank: FortuneRank,
  seed: number,
): string {
  const pool = FORTUNE_LINES_BY_DIVISION[division][rank];
  if (!pool.length) return CL_FALLBACK_LINES[0]!;
  return pool[seed % pool.length]!;
}

function jstDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(d);
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 今日の日付＋担当者名から、1日固定の占い1行を返す */
export function buildDailyBusinessFortuneLine(
  staffName: string,
  ctx?: DailyFortuneBuildContext,
): string {
  const view = buildDailyBusinessFortuneView(staffName, ctx);
  return `🔮 今日のビジネス占い（${view.dateLabel}・${view.whoLabel}）：${view.headline}　${view.detailLine}`;
}

function normalizeDetailLine(detailRaw: string): string {
  const cleaned = detailRaw.trim();
  if (!cleaned) {
    return "👔カラー:白 ／ 🔑アイテム:メモ帳 ／ 🏃アクション:深呼吸して笑顔で挨拶";
  }
  if (cleaned.includes("👔カラー:")) {
    return cleaned;
  }
  return `👔カラー:${cleaned.replace(/^👔?/, "").trim()}`;
}

/** 今日の日付＋担当者名から、1日固定の占い2行ビューを返す */
export function buildDailyBusinessFortuneView(
  staffName: string,
  ctx: DailyFortuneBuildContext = {},
): DailyFortuneView {
  const name = staffName.normalize("NFKC").trim() || "営業の星";
  const division = resolveFortuneDivision(ctx);
  const dateKey = jstDateKey();
  const seed = hashSeed(`${dateKey}|${name}|${division}`);
  const rank = pickWeightedFortuneRank(seed);
  const line = pickFortuneLineForRank(division, rank, seed >>> 8);
  const [headlineRaw, detailRaw = ""] = line.split("\n");
  const headline = headlineRaw.trim();
  const detailLine = normalizeDetailLine(detailRaw);
  const [, m, d] = dateKey.split("-");
  const dateLabel = m && d ? `${Number(m)}/${Number(d)}` : dateKey;
  const who = name !== "営業の星" ? `${name}さん` : "あなた";
  return {
    dateLabel,
    whoLabel: who,
    headline,
    detailLine,
  };
}
