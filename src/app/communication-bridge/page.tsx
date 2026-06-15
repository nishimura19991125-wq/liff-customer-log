"use client";

import { LiffCalendarMonthPage } from "@/components/liff-calendar-month-page";
import { COMMUNICATION_BRIDGE_CALENDAR_PAGE_CONFIG } from "@/lib/liff-calendar-page-config";

export default function CommunicationBridgeCalendarPage() {
  return (
    <LiffCalendarMonthPage config={COMMUNICATION_BRIDGE_CALENDAR_PAGE_CONFIG} />
  );
}
