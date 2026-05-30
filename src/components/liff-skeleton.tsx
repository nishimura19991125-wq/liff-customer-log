/** LIFF 共通スケルトン（機密データは扱わない・表示用のみ） */

export function LiffSkeletonBar({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-slate-200/90 dark:bg-slate-700/70 ${className}`}
      aria-hidden
    />
  );
}

export function LiffSkeletonBlock({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse rounded-2xl bg-slate-100 ring-1 ring-slate-200/80 dark:bg-slate-800/80 dark:ring-slate-700/60 ${className}`}
      aria-hidden
    />
  );
}
