import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";
import type { WorkEndReportFormValues, WorkEndReportStatus } from "@/lib/work-end-report-types";
import { isWorkEndApoActivityImplemented } from "@/lib/work-end-report-types";

export function emptyWorkEndReportForm(): WorkEndReportFormValues {
  return {
    pinponCount: "",
    meetingCount: "",
    apoCount: "",
    apoActivity: "",
    workArea: "",
  };
}

export function isWorkEndReportFormSubmittable(
  form: WorkEndReportFormValues,
): boolean {
  if (!form.apoActivity.trim()) return false;
  if (isWorkEndApoActivityImplemented(form.apoActivity)) {
    return Boolean(
      form.pinponCount.trim() &&
        form.meetingCount.trim() &&
        form.apoCount.trim() &&
        form.workArea.trim(),
    );
  }
  return true;
}

export async function submitWorkEndReport(
  idToken: string,
  form: WorkEndReportFormValues,
): Promise<
  | { ok: true; status: WorkEndReportStatus }
  | { ok: false; status: number; error: string; sessionExpired?: boolean }
> {
  const res = await fetch("/api/work-end-report", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(form),
  });
  const data = (await res.json()) as WorkEndReportStatus & { error?: string };
  if (res.status === 401 && isLineSessionExpiredPayload(data)) {
    return {
      ok: false,
      status: 401,
      error: "LINE のログインが切れました。アプリを開き直してください。",
      sessionExpired: true,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error:
        data.error ??
        (res.status === 429
          ? "データ取得の利用上限に達しました。しばらく待ってから再度お試しください。"
          : "稼働終了報告に失敗しました"),
    };
  }
  return { ok: true, status: data };
}
