import { LiffSkeletonBar, LiffSkeletonBlock } from "@/components/liff-skeleton";

/** 担当顧客一覧のプレースホルダー */
export function CustomerListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="flex flex-col gap-3"
      aria-busy="true"
      aria-label="担当顧客一覧を読み込み中"
    >
      {Array.from({ length: rows }, (_, i) => (
        <LiffSkeletonBlock key={i} className="h-[4.5rem] w-full" />
      ))}
    </div>
  );
}
