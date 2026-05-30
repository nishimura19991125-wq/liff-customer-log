import { LiffSkeletonBar, LiffSkeletonBlock } from "@/components/liff-skeleton";

/** 工事カレンダー月表示のプレースホルダー */
export function CalendarMonthSkeleton() {
  return (
    <div aria-busy="true" aria-label="カレンダーを読み込み中">
      <div className="mb-4 grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }, (_, i) => (
          <LiffSkeletonBar key={`h-${i}`} className="mx-auto h-3 w-6" />
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: 35 }, (_, i) => (
          <LiffSkeletonBlock key={i} className="aspect-square min-h-[2.75rem]" />
        ))}
      </div>
      <div className="mt-5 flex flex-col gap-2">
        <LiffSkeletonBar className="h-5 w-32" />
        <LiffSkeletonBlock className="h-16 w-full" />
        <LiffSkeletonBlock className="h-16 w-full" />
      </div>
    </div>
  );
}
