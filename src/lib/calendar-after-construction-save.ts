import "server-only";

import { NextResponse } from "next/server";

import type { AtPocketFetchAuth, AtPocketFieldRow } from "@/lib/atpocket";
import { writePocketRecordWithImportKey } from "@/lib/atpocket-write-with-import-key";
import { buildCalendarPatchAfterConstructionSave } from "@/lib/calendar-record-patch-server";
import {
  resolveConstructionImportKeyFieldId,
  resolveConstructionTNumberFieldId,
} from "@/lib/calendar-kojo";
import { notifyNewCaseCreated } from "@/lib/new-case-notification-server";
import { startServerTimingLog } from "@/lib/server-timing-log";
import { syncConstructionRecordToCustomerInfoApp } from "@/lib/sync-construction-to-customer-info";

/** 工事空枠更新・工事日未定新規のいずれも同じ後処理（お客様情報連携→カレンダーパッチ） */
export async function finalizeConstructionCalendarSave(opts: {
  calAppId: string;
  constructionRecordId: string | null;
  /** 工事レコードの T番号（既存レコードの後方互換の突合に使う） */
  constructionUniqueKey?: string | null;
  /**
   * **工事レコードに今入っている T番号**。書き戻しが要るかの判定にだけ使う。
   *
   * 省略すると constructionUniqueKey を使う（従来の呼び出しはそのまま）。
   * 従来の呼び出し元は工事レコードから読んだ値を constructionUniqueKey に
   * 渡していたので、それで判定できていた。
   *
   * お客様情報を起点にする経路（assign-customer-case）は、突合のために
   * **お客様情報側の T番号** を constructionUniqueKey に渡す。これは
   * 「工事レコードに入っている値」ではないので、そのまま判定に使うと
   * 一致してしまい書き戻しが飛ぶ。分からないときは空文字を渡すこと。
   */
  constructionRecordTNumber?: string | null;
  /** 工事レコードの取込キー（Aki番号）。お客様情報との突合の主キー */
  constructionImportKey?: string | null;
  customerName: string;
  /** LIFF で選択した住宅ステータス（お客様情報・工事アプリ連携用） */
  housingStatus?: string;
  constructionFields: AtPocketFieldRow[];
  calendarAuth: AtPocketFetchAuth;
  lineUserId?: string;
  viewYear?: number;
  viewMonth?: number;
  /** エラー文言用: 「登録」|「更新」 */
  savedVerb?: "登録" | "更新";
  /**
   * カレンダーの即時反映パッチを組み立てない。
   *
   * 画面が patch を使わず必ず再取得する経路（工事日の移動）では、
   * 組み立てた結果がそのまま捨てられる。@pocket の GET を1回減らすため
   * 呼び出し側から明示的に外せるようにしてある。
   * 既定（未指定）は従来どおり組み立てる。
   */
  skipCalendarPatch?: boolean;
  /**
   * 新規案件通知（Google Chat）を送る。
   *
   * **T番号 が新規発行される操作だけが送る。** T番号 を採番するのは
   * お客様情報アプリで、採番されるのはお客様情報レコードを新規作成した
   * ときだけ。既存を引き当てた更新は採番済みの T番号 を読み直すだけなので、
   * 送ると同じ案件の通知が何度も飛ぶ。
   *
   * - `true` … 呼び出し側が新規発行だと知っている（工事カレンダーの新規登録）
   * - `"when-customer-info-created"` … **連携の結果で決める**。
   *   空き枠カードの「新規入力」（fill-empty-slot）がこれ。空き枠に
   *   お客様名を入れると、連携が突合キーでお客様情報を探し、
   *   見つからなければ新規作成する（＝ T番号 が新規採番される）。
   *   既存が見つかれば更新なので送らない。呼び出し側はどちらになるかを
   *   事前に知りえない（連携はこの後処理の中で走る）ので、判定は下の
   *   `enabled` の1箇所に集約してある。
   * - 未指定 … 送らない。未定案件の割り当て（assign-customer-case）・
   *   工事日の移動・お客様情報からの保存は、いずれも入口で既存の T番号 を
   *   必須にしており新規発行が起きない。
   */
  notifyNewCase?: boolean | "when-customer-info-created";
  /** 成功レスポンスに追記する任意フィールド（同日空枠削除の結果など） */
  extraResponse?: Record<string, unknown>;
}): Promise<NextResponse> {
  /**
   * 後処理の内訳を1行で出す（CALENDAR_TIMING_LOG=true のときだけ）。
   *
   * 実測で finalize が全体の 67%（約11秒）を占めていた。連携（sync）の
   * どの往復に消えているかが分からないと削りようがないので、sync にも
   * この計測を渡して**1行にまとめて**出す。
   *
   * ここは全経路の共通処理なので、新規登録・空き枠入力・割り当て・移動の
   * どれを実行しても同じ内訳が取れる。
   */
  const timing = startServerTimingLog("finalize-construction-save");
  const savedVerb = opts.savedVerb ?? "更新";
  const recordId = opts.constructionRecordId?.trim() || null;
  const uniqueKey = opts.constructionUniqueKey?.trim() || null;
  const importKey = opts.constructionImportKey?.trim() || null;

  if (!recordId && !uniqueKey && !importKey) {
    return NextResponse.json(
      {
        error:
          savedVerb === "登録"
            ? `工事レコードは登録されましたが、登録内容を再取得できませんでした（お客様名「${opts.customerName}」で工事アプリを検索）。お客様情報アプリへの連携は行えません。@pocket に案件があるか、CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID・CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID の uniqueId を確認してください。`
            : "工事レコードは更新されましたが、レコードを再取得できませんでした。お客様情報アプリへの連携は行えません。",
        constructionSaved: true,
      },
      { status: 502 },
    );
  }

  const customerSync = await syncConstructionRecordToCustomerInfoApp({
    calAppId: opts.calAppId,
    constructionRecordId: recordId ?? undefined,
    constructionUniqueKey: uniqueKey ?? undefined,
    constructionImportKey: importKey ?? undefined,
    customerName: opts.customerName,
    housingStatus: opts.housingStatus,
    constructionFields: opts.constructionFields,
    calendarAuth: opts.calendarAuth,
    lineUserId: opts.lineUserId,
    timing,
  });

  if (customerSync.kind === "failed") {
    timing.flush({ result: "sync-failed" });
    return NextResponse.json(
      {
        error: `${customerSync.error}（工事アプリへの${savedVerb}は完了しています）`,
        constructionSaved: true,
      },
      { status: 502 },
    );
  }

  /**
   * お客様情報アプリが採番した T番号 を工事アプリへ書き戻す。
   *
   * 採番元が入れ替わったため、この一往復をしないと工事アプリの T番号 が
   * 空のままになる。カレンダーの表示・工事報告アプリとの突合・
   * キャンセル処理が T番号 を見ているので、ここで揃えておく。
   *
   * 失敗しても登録・更新は成立しているので、警告だけ残して先へ進む
   */
  const syncedTNumber =
    customerSync.kind === "synced" ? customerSync.tNumber?.trim() : "";
  /**
   * 新規案件通知。**T番号 が分かった時点で走らせる。**
   *
   * 送信は Google Chat への1往復（最長5秒）で、下の T番号 書き戻し・
   * 監査ログ・カレンダーパッチとは互いに関係が無い。直列に待つ理由が
   * 無いので走らせたまま進み、返す前に合流させる。
   * notifyNewCaseCreated は例外を投げないので、ここで catch は要らない。
   *
   * ⚠ **送らないときも必ず呼ぶ。** ここで握り潰すと、送らなかった理由が
   *   ログに残らない。実装直後に「通知が届かない」が起きたとき、
   *   notifyNewCase・T番号・環境変数のどれで止まったのかを切り分けられ
   *   なかったのがこれ。判断と記録は notifyNewCaseCreated に集約する。
   */
  const pendingNewCaseNotification = notifyNewCaseCreated({
    /**
     * 送るかどうかの判定は**ここだけ**。呼び出し側へ書き写さないこと。
     *
     * 新規登録は呼び出し側が true を渡す。空き枠入力は連携が走るまで
     * 新規作成か更新かが決まらないので、この後処理が連携の結果
     * （customerInfoCreated）で決める。同じ判定を呼び出し側にも置くと、
     * 片方だけ直したときに通知が黙って消える／二重に飛ぶ。
     */
    source: "finalize",
    enabled:
      opts.notifyNewCase === true ||
      (opts.notifyNewCase === "when-customer-info-created" &&
        customerSync.kind === "synced" &&
        customerSync.customerInfoCreated),
    tNumber: syncedTNumber,
    customerName: opts.customerName,
    lineUserId: opts.lineUserId,
  });

  /**
   * 工事レコードに今入っている T番号。
   * 明示されていなければ、従来どおり突合キーを「レコードの値」とみなす。
   */
  const currentRecordTNumber =
    opts.constructionRecordTNumber === undefined
      ? uniqueKey
      : (opts.constructionRecordTNumber?.trim() || "");
  /**
   * 連携が走らせたままの監査ログ。**必ずここで合流させる。**
   *
   * 監査ログ（実測 1.2 秒）と下の T番号 書き戻し（0.28 秒）は、
   * 別のアプリの別のレコードを触るだけで順序に意味が無い。書き戻しの
   * 往復ぶんを監査ログの裏に隠す。
   */
  const pendingAudit =
    customerSync.kind === "synced" ? customerSync.pendingAudit : undefined;

  /**
   * T番号 が空だと書き戻しは丸ごと飛ぶ。
   *
   * 新規案件通知が落ちていたのと**同じ原因**（お客様情報の採番を読めて
   * いない）でここも落ちる。通知は届かないので気付けるが、書き戻しは
   * 誰も見ていないと気付けない。工事アプリの T番号 はカレンダー表示・
   * 工事報告アプリとの突合・キャンセル処理が見ているので、静かに欠けると
   * 後から効いてくる。飛んだことを必ず残す。
   */
  if (recordId && !syncedTNumber) {
    console.error(
      "[calendar-after-construction-save] T番号 が空のため工事アプリへ書き戻せません",
      JSON.stringify({
        calAppId: opts.calAppId,
        recordId,
        syncKind: customerSync.kind,
      }),
    );
  }

  if (recordId && syncedTNumber && syncedTNumber !== currentRecordTNumber) {
    const tNumberFieldId = resolveConstructionTNumberFieldId(
      opts.constructionFields,
    );
    const importKeyFieldId = resolveConstructionImportKeyFieldId(
      opts.constructionFields,
    );
    if (tNumberFieldId) {
      try {
        await writePocketRecordWithImportKey({
          appId: opts.calAppId,
          recordId,
          payload: {
            [tNumberFieldId]: syncedTNumber,
            ...(importKeyFieldId && importKey
              ? { [importKeyFieldId]: importKey }
              : {}),
          },
          importKeyFieldId: importKeyFieldId ?? undefined,
          readAuth: opts.calendarAuth,
          writeAuth: opts.calendarAuth,
          allowMissingImportKey: true,
        });
      } catch (e) {
        console.error(
          "[calendar-after-construction-save] T番号を工事アプリへ書き戻せませんでした",
          { calAppId: opts.calAppId, recordId },
          e instanceof Error ? e.message : String(e),
        );
      }
      timing.mark("tnumber-writeback");
    }
  }

  // 監査ログを書き切ってから先へ進む（返した瞬間に実行環境が凍結する）
  if (pendingAudit) {
    await pendingAudit;
    timing.mark("audit");
  }

  const calendarPatch =
    recordId && !opts.skipCalendarPatch
      ? await buildCalendarPatchAfterConstructionSave(
        opts.calAppId,
        recordId,
        opts.calendarAuth,
        opts.viewYear,
        opts.viewMonth,
      )
    : null;

  timing.mark("calendar-patch");

  // 返した瞬間に実行環境が凍結する。送り終えてから返す
  await pendingNewCaseNotification;
  timing.mark("new-case-notify");

  timing.flush({
    result: "ok",
    // どこへ書いた結果かの目安（数値・固定文字列のみ）
    syncKind: customerSync.kind,
    calendarPatch: Boolean(calendarPatch),
  });

  // Dropbox フォルダを用意できなくても登録・更新は成功として返す（E-5）。
  // 画面側は warning を成功メッセージとは別に目立たせて出す。
  const dropboxWarning =
    customerSync.kind === "synced" ? customerSync.dropboxWarning : undefined;

  return NextResponse.json({
    ok: true,
    customerInfoSynced: customerSync.kind === "synced",
    ...(recordId ? { recordId } : {}),
    ...(calendarPatch ? { calendarPatch } : {}),
    ...(dropboxWarning ? { warning: dropboxWarning } : {}),
    ...(opts.extraResponse ?? {}),
  });
}
