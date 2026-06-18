"use client";

import { useCallback, useEffect, useState } from "react";

import { MeetingSetCreatedInputAlert } from "@/components/meeting-set-created-input-alert";
import {
  MEETING_SET_CREATED_ALERT_CHECK_EVENT,
  fetchPendingMeetingAlerts,
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
  const [items, setItems] = useState<MeetingScheduleAlertItem[] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(
    async (force = false) => {
      if (!active) return;
      if (dismissed && !force) return;
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
          setDismissed(false);
          setItems(pending);
        }
      } catch {
        // ignore
      }
    },
    [active, dismissed, idToken],
  );

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    if (!active) return;
    const onCheck = () => {
      void check(true);
    };
    window.addEventListener(MEETING_SET_CREATED_ALERT_CHECK_EVENT, onCheck);
    return () => {
      window.removeEventListener(MEETING_SET_CREATED_ALERT_CHECK_EVENT, onCheck);
    };
  }, [active, check]);

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
