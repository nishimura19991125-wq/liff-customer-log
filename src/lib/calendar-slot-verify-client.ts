import {
  CALENDAR_SLOT_CONFLICT_MESSAGE,
  isCalendarSlotConflictBody,
} from "@/lib/calendar-slot-conflict";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";

export { CALENDAR_SLOT_CONFLICT_MESSAGE };

/** 登録直前の空枠検証（SWR キャッシュを経由しない） */
export async function verifyConstructionEmptySlotBeforeSubmit(
  token: string,
  recordId: string,
): Promise<
  | { ok: true }
  | { conflict: true }
  | { sessionExpired: true }
  | { error: string }
> {
  const res = await fetch(
    `/api/calendar/verify-empty-slot?${new URLSearchParams({ recordId })}`,
    {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    },
  );
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status === 401 && isLineSessionExpiredPayload(body)) {
    return { sessionExpired: true };
  }
  if (res.status === 409 && isCalendarSlotConflictBody(body)) {
    return { conflict: true };
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : "空枠の確認に失敗しました";
    return { error: msg };
  }
  return { ok: true };
}

export function isCalendarSlotConflictApiResponse(
  status: number,
  body: unknown,
): boolean {
  return status === 409 && isCalendarSlotConflictBody(body);
}
