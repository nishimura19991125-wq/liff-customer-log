export type MeetingScheduleScheduledUpdateInput = {
  scheduledYmd: string;
  scheduledTime?: string | null;
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

function normalizeTime(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function validateMeetingScheduleScheduledUpdate(
  input: MeetingScheduleScheduledUpdateInput,
): { ok: true; normalized: { scheduledYmd: string; scheduledTime: string } } | { ok: false; error: string } {
  const scheduledYmd = normalizeYmd(input.scheduledYmd);
  if (!scheduledYmd) {
    return { ok: false, error: "商談予定日を入力してください" };
  }

  const scheduledTime = normalizeTime(input.scheduledTime);
  if ((input.scheduledTime ?? "").trim() && !scheduledTime) {
    return { ok: false, error: "商談予定時刻は HH:MM 形式で入力してください" };
  }

  return {
    ok: true,
    normalized: { scheduledYmd, scheduledTime },
  };
}
