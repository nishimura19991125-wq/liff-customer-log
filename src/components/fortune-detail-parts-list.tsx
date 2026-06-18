import {
  fortuneDetailRows,
  parseFortuneDetailParts,
} from "@/lib/daily-omikuji-detail";

type Props = {
  detailLine: string;
  /** カード用コンパクト / モーダル用 default */
  variant?: "card" | "modal";
};

export function FortuneDetailPartsList({
  detailLine,
  variant = "modal",
}: Props) {
  const rows = fortuneDetailRows(parseFortuneDetailParts(detailLine));
  if (rows.length === 0) return null;

  if (variant === "card") {
    return (
      <ul className="mt-3 space-y-2 rounded-xl border border-amber-200/60 bg-white/80 p-3 dark:border-amber-800/30 dark:bg-slate-900/50">
        {rows.map((item) => (
          <li
            key={item.label}
            className="flex gap-2 text-[12px] leading-snug text-slate-700 dark:text-slate-300"
          >
            <span className="shrink-0 text-[14px]" aria-hidden>
              {item.icon}
            </span>
            <span className="min-w-0">
              <span className="font-medium text-slate-500 dark:text-slate-400">
                {item.label}
              </span>
              <span className="mx-1 text-slate-300 dark:text-slate-600">·</span>
              <span
                className={
                  item.emphasize
                    ? "font-semibold text-slate-800 dark:text-slate-100"
                    : ""
                }
              >
                {item.value}
              </span>
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="mt-5 space-y-2 rounded-xl bg-white/70 p-3 text-sm dark:bg-slate-800/60">
      {rows.map((item) => (
        <li
          key={item.label}
          className="flex gap-2 leading-snug text-slate-700 dark:text-slate-300"
        >
          <span className="shrink-0" aria-hidden>
            {item.icon}
          </span>
          <span>
            <span className="font-medium">{item.label}</span>
            <span className="text-slate-500 dark:text-slate-400"> · </span>
            <span
              className={
                item.emphasize
                  ? "font-semibold text-slate-800 dark:text-slate-100"
                  : ""
              }
            >
              {item.value}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
