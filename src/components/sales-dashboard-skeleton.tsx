import { LiffSkeletonBar, LiffSkeletonBlock } from "@/components/liff-skeleton";

/** 営業ダッシュボード本体のプレースホルダー */
export function SalesDashboardSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      aria-busy="true"
      aria-label="ダッシュボードを読み込み中"
    >
      <LiffSkeletonBar className="h-4 w-48" />
      <LiffSkeletonBlock className="h-36 w-full" />
      <div className="flex gap-2 overflow-hidden">
        <LiffSkeletonBar className="h-10 w-28 shrink-0 rounded-2xl" />
        <LiffSkeletonBar className="h-10 w-32 shrink-0 rounded-2xl" />
        <LiffSkeletonBar className="h-10 w-28 shrink-0 rounded-2xl" />
        <LiffSkeletonBar className="h-10 w-24 shrink-0 rounded-2xl" />
      </div>
      <LiffSkeletonBar className="h-5 w-40" />
      <LiffSkeletonBlock className="h-28 w-full" />
      <LiffSkeletonBlock className="h-24 w-full" />
      <LiffSkeletonBlock className="h-24 w-full" />
      <LiffSkeletonBlock className="h-20 w-full" />
    </div>
  );
}
