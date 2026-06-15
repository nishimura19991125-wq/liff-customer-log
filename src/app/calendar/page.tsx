"use client";

import { LiffCalendarMonthPage } from "@/components/liff-calendar-month-page";
import { CONSTRUCTION_CALENDAR_PAGE_CONFIG } from "@/lib/liff-calendar-page-config";

export default function CalendarPage() {
  return <LiffCalendarMonthPage config={CONSTRUCTION_CALENDAR_PAGE_CONFIG} />;
}
