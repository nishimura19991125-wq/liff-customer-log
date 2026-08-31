import "server-only";

/**
 * Google Chat の Incoming Webhook 送信（タスクR: 契約速報／タスクW: 出勤打刻／新規案件通知）。
 *
 * ── Webhook URL の扱い ─────────────────────────────────────
 * URL 自体が認証情報を兼ねる。漏れると誰でもそのスペースへ投稿できるため、
 * ログ・レスポンス・エラーメッセージのいずれにも出さない。
 * fetch の失敗理由（cause）には URL が含まれうるので、例外オブジェクトは
 * そのまま握って捨て、種別だけを呼び出し側へ返す。
 * クライアントへは値も設定有無も渡さない（サーバ側でのみ使う）。
 */

/** 応答が返らないと保存の応答まで返らなくなるため既定5秒で打ち切る */
const DEFAULT_TIMEOUT_MS = 5000;

function contractWebhookUrl(): string {
  return process.env.GOOGLE_CHAT_CONTRACT_WEBHOOK_URL?.trim() ?? "";
}

/**
 * 契約速報の Webhook が設定されているか。
 *
 * 未設定でもエラーにしない。環境変数が用意される前にデプロイされても
 * 既存の保存機能が止まらないようにする。
 */
export function googleChatContractWebhookConfigured(): boolean {
  return contractWebhookUrl() !== "";
}

export type GoogleChatSendResult =
  | { kind: "sent" }
  | { kind: "skipped"; reason: "not-configured" | "empty-text" }
  /** status は HTTP 応答があったときだけ入る。URL は含めない */
  | {
      kind: "failed";
      reason: "http" | "timeout" | "network";
      status?: number;
      /**
       * 失敗した応答の本文（先頭 200 文字・URL 除去済み）。
       *
       * logLabel を渡した送信でだけ入る。Google Chat は 400 の理由を
       * 本文でしか返さない（スペースが消えている・Webhook が無効など）ので、
       * ステータスだけでは直しようがない。
       */
      detail?: string;
    };

function attendanceWebhookUrl(): string {
  return process.env.GOOGLE_CHAT_ATTENDANCE_WEBHOOK_URL?.trim() ?? "";
}

/**
 * 出勤打刻の Webhook が設定されているか（タスクW）。
 *
 * 契約速報とは**別の Webhook**。同じスペースへ送りたい場合は、
 * 運用側で同じ URL を両方に設定すればよい。
 * 未設定でもエラーにしない（打刻が止まらないようにする）。
 */
export function googleChatAttendanceWebhookConfigured(): boolean {
  return attendanceWebhookUrl() !== "";
}

function newCaseWebhookUrl(): string {
  return process.env.GOOGLE_CHAT_NEW_CASE_WEBHOOK_URL?.trim() ?? "";
}

/**
 * 新規案件通知の Webhook が設定されているか。
 *
 * 契約速報・出勤打刻とは**別の Webhook**。同じスペースへ送りたい場合は、
 * 運用側で同じ URL を両方に設定すればよい。
 * 未設定でもエラーにしない（工事カレンダーの新規登録が止まらないようにする）。
 */
export function googleChatNewCaseWebhookConfigured(): boolean {
  return newCaseWebhookUrl() !== "";
}

function attendanceListWebhookUrl(): string {
  return process.env.GOOGLE_CHAT_ATTENDANCE_LIST_WEBHOOK_URL?.trim() ?? "";
}

/**
 * 定時リストの Webhook が設定されているか（タスクY）。
 *
 * 打刻通知（GOOGLE_CHAT_ATTENDANCE_WEBHOOK_URL）とは**別の Webhook**。
 * 未設定でもエラーにしない（定時実行が落ちないようにする）。
 */
export function googleChatAttendanceListWebhookConfigured(): boolean {
  return attendanceListWebhookUrl() !== "";
}

/**
 * 契約速報を Google Chat へ送る。
 *
 * 例外は投げない。呼び出し側は保存を成功させたまま warning を出す。
 */
export async function sendGoogleChatContractMessage(
  text: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<GoogleChatSendResult> {
  return sendGoogleChatMessage(contractWebhookUrl(), text, timeoutMs);
}

/**
 * 出勤打刻を Google Chat へ送る。
 *
 * 例外は投げない。呼び出し側は打刻を成功させたまま warning を出す。
 */
export async function sendGoogleChatAttendanceMessage(
  text: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<GoogleChatSendResult> {
  return sendGoogleChatMessage(attendanceWebhookUrl(), text, timeoutMs);
}

/**
 * 勤怠の定時リストを Google Chat へ送る（タスクY）。
 *
 * 例外は投げない。定時実行は結果を返す相手がいないので、
 * 呼び出し側は結果を console に残すだけでよい。
 */
export async function sendGoogleChatAttendanceListMessage(
  text: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<GoogleChatSendResult> {
  return sendGoogleChatMessage(attendanceListWebhookUrl(), text, timeoutMs);
}

/**
 * 新規案件通知を Google Chat へ送る。
 *
 * 例外は投げない。呼び出し側は登録を成功させたまま先へ進む。
 */
export async function sendGoogleChatNewCaseMessage(
  text: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<GoogleChatSendResult> {
  // fetch まで届いたかを追えるようにする（届かない件の切り分け用）
  return sendGoogleChatMessage(newCaseWebhookUrl(), text, timeoutMs, "new-case");
}

/** 失敗した応答から読む本文の上限。原因の見当がつけば十分 */
const FAILURE_BODY_MAX = 200;

/**
 * 応答本文から URL らしき文字列を落とす。
 *
 * Google Chat の失敗応答は理由の文言だけを返し Webhook URL を含めないが、
 * **含まない前提には立たない**。ログへ出す前にここを必ず通す。
 */
function withoutUrls(raw: string): string {
  return raw.replace(/https?:\/\/\S+/gi, "[url]");
}

/** 失敗の理由は本文にしか入らない。読めなければ空文字 */
async function failureDetail(res: Response): Promise<string> {
  try {
    const body = await res.text();
    return withoutUrls(body).replace(/\s+/g, " ").trim().slice(0, FAILURE_BODY_MAX);
  } catch {
    return "";
  }
}

/** 送信の実体。URL の出どころだけが違うので1本にまとめている */
async function sendGoogleChatMessage(
  url: string,
  text: string,
  timeoutMs: number,
  /**
   * ログに出す送信元の名前。**渡したときだけ**送信の前後を記録する。
   * 既存の送信（契約速報・出勤打刻・定時リスト）の挙動は変えない。
   */
  logLabel?: string,
): Promise<GoogleChatSendResult> {
  if (!url) return { kind: "skipped", reason: "not-configured" };
  if (!text.trim()) return { kind: "skipped", reason: "empty-text" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // 「fetch まで来たか」を切り分けるための1行。URL は出さない
    if (logLabel) {
      console.info(
        "[google-chat] fetch を呼びます",
        JSON.stringify({ label: logLabel, textLength: text.length, timeoutMs }),
      );
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (logLabel) {
      console.info(
        "[google-chat] 応答を受け取りました",
        JSON.stringify({ label: logLabel, status: res.status, ok: res.ok }),
      );
    }
    if (!res.ok) {
      const detail = logLabel ? await failureDetail(res) : "";
      return {
        kind: "failed",
        reason: "http",
        status: res.status,
        ...(detail ? { detail } : {}),
      };
    }
    return { kind: "sent" };
  } catch (e) {
    // e には URL が載りうる。中身は見ず、打ち切りかどうかだけ判定する
    const aborted =
      typeof e === "object" &&
      e !== null &&
      (e as { name?: unknown }).name === "AbortError";
    return { kind: "failed", reason: aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
