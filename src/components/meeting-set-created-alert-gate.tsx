"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { MeetingSetCreatedInputAlert } from "@/components/meeting-set-created-input-alert";
import {
  MEETING_SET_CREATED_ALERT_CHECK_EVENT,
  clearMeetingScheduleAlertSnooze,
  fetchPendingMeetingAlerts,
  isMeetingScheduleAlertSnoozed,
  type MeetingScheduleAlertCheckDetail,
} from "@/lib/meeting-schedule-pending-set-created-client";
import type { MeetingScheduleAlertItem } from "@/lib/meeting-schedule-types";

type AttendancePreview = {
  configured?: boolean;
  disabled?: boolean;
  needsStaffBind?: boolean;
  clockIn?: string | null;
};

type Props = {
  idToken: string;
  active: boolean;
};

export function MeetingSetCreatedAlertGate({ idToken, active }: Props) {
  const pathname = usePathname();
  const [items, setItems] = useState<MeetingScheduleAlertItem[] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (!active) return;
      if (pathname === "/meeting-schedule") return;
      if (!force && (dismissed || isMeetingScheduleAlertSnoozed())) return;
      try {
        const res = await fetch("/api/attendance", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as AttendancePreview;
        if (
          data.disabled ||
          data.needsStaffBind ||
          data.configured === false ||
          !data.clockIn
        ) {
          return;
        }
        const pending = await fetchPendingMeetingAlerts(idToken);
        if (pending.length > 0) {
          if (force) {
            clearMeetingScheduleAlertSnooze();
            setDismissed(false);
          }
          setItems(pending);
          return;
        }
        clearMeetingScheduleAlertSnooze();
        setItems(null);
      } catch {
        // ignore
      }
    },
    [active, dismissed, idToken, pathname],
  );

  useEffect(() => {
    if (pathname === "/meeting-schedule") {
      setDismissed(true);
      setItems(null);
      return;
    }
    const forceOnMenu = pathname === "/";
    void check({ force: forceOnMenu });
  }, [check, pathname]);

  useEffect(() => {
    if (!active) return;
    const onCheck = (event: Event) => {
      const detail = (event as CustomEvent<MeetingScheduleAlertCheckDetail>)
        .detail;
      void check({ force: detail?.force === true });
    };
    window.addEventListener(MEETING_SET_CREATED_ALERT_CHECK_EVENT, onCheck);
    return () => {
      window.removeEventListener(MEETING_SET_CREATED_ALERT_CHECK_EVENT, onCheck);
    };
  }, [active, check]);

  if (pathname === "/meeting-schedule") return null;
  if (!items?.length || dismissed) return null;

  return (
    <MeetingSetCreatedInputAlert
      items={items}
      onClose={() => {
        setDismissed(true);
        setItems(null);
      }}
    />
  );
}
