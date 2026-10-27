import "server-only";

import { NextResponse } from "next/server";

import { isCalendarConstructionMoveEnabled } from "@/lib/calendar-construction-move-flag";

/** 拒否の文言。内部の事情（変数名・止めている理由）は出さない */
export const CONSTRUCTION_MOVE_DISABLED_MESSAGE =
  "この操作は現在ご利用いただけません。";

/**
 * 工事日を変える API の入口で呼ぶ。止めているときは 403 を返す。
 *
 * ⚠ 認証・本文の読み取りより前に呼ぶこと。止めているときは
 *    何も読まず、@pocket にも問い合わせない。
 *
 * 呼んでいるのは move-construction-case / assign-case-to-slot /
 * schedule-undated-case の3本だけ。後ろ2本はどの画面からも呼ばれて
 * いないが、直接叩けば工事日を書けるので同じく止める。
 */
export function rejectWhenConstructionMoveDisabled(): NextResponse | null {
  if (isCalendarConstructionMoveEnabled()) return null;
  return NextResponse.json(
    { error: CONSTRUCTION_MOVE_DISABLED_MESSAGE },
    { status: 403 },
  );
}
