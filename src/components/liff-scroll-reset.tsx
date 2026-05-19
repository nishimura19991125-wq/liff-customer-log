"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** 横位置をリセットし、先頭へ縦スクロール */
export function resetLiffScroll() {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  document.documentElement.scrollLeft = 0;
  document.body.scrollLeft = 0;
}

/** ルート切替時に resetLiffScroll を実行 */
export function LiffScrollReset() {
  const pathname = usePathname();

  useEffect(() => {
    resetLiffScroll();
  }, [pathname]);

  return null;
}
