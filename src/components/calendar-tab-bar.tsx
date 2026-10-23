"use client";

export type CalendarTabKey = "calendar" | "management";

const TABS: { key: CalendarTabKey; label: string }[] = [
  { key: "calendar", label: "工事カレンダー" },
  { key: "management", label: "施工管理" },
];

/**
 * 工事カレンダーのページ上部のタブ（横幅いっぱいのセグメント型）。
 * 切り替えは画面内の状態だけで行い、ページは再読み込みしない。
 */
export function CalendarTabBar({
  active,
  onChange,
}: {
  active: CalendarTabKey;
  onChange: (key: CalendarTabKey) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="表示の切り替え"
      className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200/80 p-1 dark:bg-slate-800"
    >
      {TABS.map((t) => {
        const selected = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(t.key)}
            className={`min-h-11 rounded-lg px-2 text-[15px] font-bold transition active:scale-[0.98] ${
              selected
                ? "bg-[#16A34A] text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {selected ? <span aria-hidden className="mr-1">✓</span> : null}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
