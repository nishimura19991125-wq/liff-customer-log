"use client";

import { useEffect, useState } from "react";

import {
  DAILY_OMIKUJI_SHOWN_EVENT,
  isDailyOmikujiShownToday,
} from "@/lib/daily-omikuji-shown";

/** 暗証番号解除後の今日のおみくじを表示済みか（同一タブ内の表示イベントも反映） */
export function useDailyOmikujiShownToday(
  staffName: string | null | undefined,
): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const sync = () => {
      if (!staffName?.trim()) {
        setShown(false);
        return;
      }
      setShown(isDailyOmikujiShownToday(staffName));
    };

    sync();
    window.addEventListener(DAILY_OMIKUJI_SHOWN_EVENT, sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(DAILY_OMIKUJI_SHOWN_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, [staffName]);

  return shown;
}
