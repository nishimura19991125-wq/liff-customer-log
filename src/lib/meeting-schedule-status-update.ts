import { isMeetingScheduleSetCreatedStatus } from "@/lib/meeting-schedule-shared";

export type MeetingScheduleStatusUpdateInput = {
  status: string;
  meetingDate?: string | null;
  closeType?: string | null;
  meetingPlace?: string | null;
};

function normalizeYmd(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return "";
}

export function validateMeetingScheduleStatusUpdate(
  input: MeetingScheduleStatusUpdateInput,
): { ok: true; normalized: MeetingScheduleStatusUpdateInput } | { ok: false; error: string } {
  const status = input.status.trim();
  if (!status) {
    return { ok: false, error: "status が必要です" };
  }

  if (!isMeetingScheduleSetCreatedStatus(status)) {
    return {
      ok: true,
      normalized: { status },
    };
  }

  const meetingDate = normalizeYmd(input.meetingDate);
  const closeType = (input.closeType ?? "").trim();
  const meetingPlace = (input.meetingPlace ?? "").trim();

  if (!meetingDate) {
    return { ok: false, error: "初回商談実施日を入力してください" };
  }
  if (!closeType) {
    return { ok: false, error: "片クロor両クロを選択してください" };
  }
  if (!meetingPlace) {
    return { ok: false, error: "商談場所を選択してください" };
  }

  return {
    ok: true,
    normalized: {
      status,
      meetingDate,
      closeType,
      meetingPlace,
    },
  };
}
