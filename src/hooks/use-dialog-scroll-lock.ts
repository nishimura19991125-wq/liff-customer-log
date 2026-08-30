"use client";

import { useEffect } from "react";

/**
 * ダイアログが開いている間、背後のページのスクロールを止める。
 *
 * 勤怠アラート・掲示板・月カレンダーは以前から同じことを各自でやっている
 * （document.body.style.overflow を退避して "hidden"）。確認ダイアログには
 * 入っておらず、ダイアログを開いたまま背後が動いてしまう。実機では、覆いが
 * 潰れてタップが背後へ抜けた件とあわせて「背後のパネルが見えている／触れる」
 * ように見えていた。
 *
 * ■ 参照カウントで数える
 * 確認ダイアログの上にさらに別のダイアログが開くことがある。各自で
 * 退避・復元すると、内側が閉じた時点で外側の分まで戻してしまう。
 * 開いている数を数え、0 になったときだけ元へ戻す。
 *
 * ■ touch-action は触らない
 * body に touch-action:none を置くと、**ダイアログの中身もスクロール
 * できなくなる**（子孫のタッチ操作まで殺す）。背後へのスクロール伝播は
 * ダイアログ側の overscroll-contain で止めてある。
 */

let lockCount = 0;
let savedOverflow = "";

export function useDialogScrollLock(open: boolean): void {
  useEffect(() => {
    if (!open) return;

    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        document.body.style.overflow = savedOverflow;
      }
    };
  }, [open]);
}

/** テスト用。モジュールの数え上げを初期化する */
export function resetDialogScrollLockForTest(): void {
  lockCount = 0;
  savedOverflow = "";
}
