const RANK_STYLES: Record<string, string> = {
  超大吉: "bg-amber-400 text-red-900",
  大吉: "bg-red-500 text-white",
  中吉: "bg-orange-500 text-white",
  小吉: "bg-emerald-500 text-white",
  吉: "bg-sky-500 text-white",
  凶: "bg-slate-400 text-white",
  大凶: "bg-slate-700 text-slate-100",
};

export function parseFortuneHeadline(headline: string): {
  rank: string;
  body: string;
} {
  const match = headline.match(/^【(.+?)】(.+)$/);
  if (!match) return { rank: "吉", body: headline };
  return { rank: match[1]!, body: match[2]!.trim() };
}

export function fortuneRankStyle(rank: string): string {
  return RANK_STYLES[rank] ?? "bg-amber-400 text-red-900";
}

/** 運勢ランクの小さなバッジ（アカウント名下・おみくじカード共用） */
export function FortuneRankBadge({
  rank,
  size = "md",
}: {
  rank: string;
  size?: "sm" | "md";
}) {
  const sizeClass =
    size === "sm"
      ? "rounded px-1.5 py-0.5 text-[10px] font-black tracking-wide"
      : "rounded-lg px-2 py-1 text-[13px] font-black tracking-wide";

  return (
    <span className={`inline-block ${sizeClass} ${fortuneRankStyle(rank)}`}>
      {rank}
    </span>
  );
}
