"use client";

import { useState } from "react";

import { CalendarTabBar, type CalendarTabKey } from "@/components/calendar-tab-bar";
import { ConstructionManagementPanel } from "@/components/construction-management-panel";
import { LiffScreen } from "@/components/liff-chrome";
import { LiffCalendarMonthPage } from "@/components/liff-calendar-month-page";
import { CONSTRUCTION_CALENDAR_PAGE_CONFIG } from "@/lib/liff-calendar-page-config";

/**
 * 工事カレンダー / 施工管理 のタブ。
 *
 * ■ 工事カレンダーは既存の画面をそのまま出す
 * LiffCalendarMonthPage には手を入れていない。タブを切り替えても
 * 外さずに隠すだけにしてあるので、表示中の月・選択日・絞り込みが保たれ、
 * 戻ったときに取り直しも起きない。
 *
 * ■ 施工管理は初めて開いたときに読み込む
 * 開かない人のために API を呼ばない。一度開いたら同じく隠すだけにする。
 */
export default function CalendarPage() {
  const [tab, setTab] = useState<CalendarTabKey>("calendar");
  const [managementOpened, setManagementOpened] = useState(false);

  const changeTab = (next: CalendarTabKey) => {
    if (next === "management") setManagementOpened(true);
    setTab(next);
  };

  return (
    <div className="calendar-tab-shell min-w-0">
      <div className="sticky top-0 z-30 bg-slate-50 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-5 dark:bg-slate-900">
        <div className="mx-auto w-full max-w-xl">
          <CalendarTabBar active={tab} onChange={changeTab} />
        </div>
      </div>

      <div hidden={tab !== "calendar"}>
        <LiffCalendarMonthPage config={CONSTRUCTION_CALENDAR_PAGE_CONFIG} />
      </div>

      {managementOpened ? (
        <div hidden={tab !== "management"}>
          <LiffScreen>
            <ConstructionManagementPanel />
          </LiffScreen>
        </div>
      ) : null}
    </div>
  );
}
