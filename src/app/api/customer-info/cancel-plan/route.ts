import { NextResponse } from "next/server";

import { customerCancelDeletesConstructionRecordEnabled } from "@/lib/customer-cancel-delete-guard";
import type { CustomerCancelPlan } from "@/lib/customer-cancel-plan";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

/**
 * キャンセル確認画面に出す「実行される内容」を返す（タスクV-6）。
 *
 * レコードは一切変更しない。実行内容はサーバの設定で決まるので、
 * **判断はサーバに一本化**し、画面はその結果だけを表示する。
 *
 * 以前は空き枠を作るかどうか（営業日・祝日の判定）を返していた。
 * 空き枠の自動作成を廃止したので、その判定は返さない。
 *
 * 返すのは「工事登録アプリのレコードを削除するか」だけ。削除は
 * CUSTOMER_CANCEL_DELETE_CONSTRUCTION_RECORD=false で止められるので、
 * 止めている間は確認画面の文言も「項目を消します」のほうになる。
 * 保存時（runCustomerCancelSideEffects）も同じ関数で判断する。
 */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const plan: CustomerCancelPlan = {
    deletesConstructionRecord: customerCancelDeletesConstructionRecordEnabled(),
  };
  return NextResponse.json({ ok: true, plan });
}
