import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

/**
 * お客様情報の入力内容を端末に自動退避する（タスクJ）。
 *
 * LIFF を誤って閉じると入力が最初からになる、という声への対応。
 * 必須項目が埋まるまで @pocket へ保存できないため、途中保存の代わりに
 * ブラウザの localStorage へ退避しておき、次に同じ顧客を開いたときに
 * 復元するかどうかを尋ねる。
 *
 * ■ プライバシー上の注意（重要）
 * 退避データには顧客の個人情報（氏名・住所・電話番号・契約内容）が入る。
 * localStorage は同一オリジンの全ページから読める。LIFF は単一オリジンなので
 * 他社のサイトから読まれることはないが、**端末を共有している場合は同じ端末の
 * 他の利用者がブラウザの開発者ツールなどで見ることができる**。
 * そのため
 *   - @pocket への保存に成功したら必ず削除する
 *   - 「破棄する」を選んだら削除する
 *   - 期限（既定7日）を過ぎたものは、読み込み時に他の顧客の分もまとめて削除する
 * の3つで、端末に残り続けないようにしている。
 * 退避データの中身をログへ出してはならない。
 *
 * sessionStorage はタブを閉じると消えるため、この用途には使えない。
 */

/** 顧客ごとにキーを分ける。複数の顧客を並行して編集しても混ざらない */
export const CUSTOMER_INFO_DRAFT_KEY_PREFIX = "customer-info-draft:";

/** 退避データの寿命。個人情報を端末に残し続けないため既定7日 */
export const CUSTOMER_INFO_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 入力のたびに書かず、この間隔だけ入力が止まってから書く */
export const CUSTOMER_INFO_DRAFT_DEBOUNCE_MS = 1000;

/** 形式のバージョン。将来キーの意味が変わったら古い退避を捨てる */
const DRAFT_FORMAT_VERSION = 1;

export type CustomerInfoDraft = {
  v: number;
  recordId: string;
  /** 退避した時刻（epoch ミリ秒） */
  savedAt: number;
  /**
   * 退避したときに読み込んでいたレコードの状態（J-3）。
   * 復元しようとした時点の値と突き合わせ、その間に他の人が @pocket 側を
   * 更新していないかを判定する。
   */
  baseHash: string;
  values: CustomerInfoFormValues;
};

export function customerInfoDraftKey(recordId: string): string {
  return `${CUSTOMER_INFO_DRAFT_KEY_PREFIX}${recordId}`;
}

/**
 * 読み込んだ値全体のハッシュ。
 *
 * @pocket のレコード更新日時は API 応答に含まれていないため、
 * 「読み込んだ値全体のハッシュ」で代用する（J-3 の但し書き）。
 *
 * - キー順に依存しない（並べ替えてから連結する）
 * - 空文字と未設定を同じものとして扱う（API が空の列を省くことがある）
 */
export function hashCustomerInfoValues(
  values: CustomerInfoFormValues | null | undefined,
): string {
  const entries = Object.entries(values ?? {})
    .map(([k, v]) => [k, typeof v === "string" ? v : ""] as const)
    .filter(([, v]) => v !== "")
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const text = JSON.stringify(entries);

  // FNV-1a（32bit）。衝突耐性より、端末上で軽く回ることを優先している。
  // 用途は「変わったかどうか」の目安であって、改ざん検知ではない
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function isCustomerInfoDraftExpired(
  draft: CustomerInfoDraft,
  nowMs: number,
  ttlMs: number = CUSTOMER_INFO_DRAFT_TTL_MS,
): boolean {
  if (!Number.isFinite(draft.savedAt)) return true;
  return nowMs - draft.savedAt >= ttlMs;
}

/** 壊れた JSON・別形式・別バージョンは復元候補にしない */
export function parseCustomerInfoDraft(
  raw: string | null | undefined,
): CustomerInfoDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (o.v !== DRAFT_FORMAT_VERSION) return null;
  if (typeof o.recordId !== "string" || !o.recordId) return null;
  if (typeof o.savedAt !== "number" || !Number.isFinite(o.savedAt)) return null;
  if (typeof o.baseHash !== "string") return null;
  if (!o.values || typeof o.values !== "object") return null;

  const values: CustomerInfoFormValues = {};
  for (const [k, v] of Object.entries(o.values as Record<string, unknown>)) {
    if (typeof v === "string") values[k] = v;
  }

  return {
    v: DRAFT_FORMAT_VERSION,
    recordId: o.recordId,
    savedAt: o.savedAt,
    baseHash: o.baseHash,
    values,
  };
}

export function buildCustomerInfoDraft(input: {
  recordId: string;
  savedAt: number;
  baseHash: string;
  values: CustomerInfoFormValues;
}): CustomerInfoDraft {
  return { v: DRAFT_FORMAT_VERSION, ...input };
}

/**
 * localStorage を取れるときだけ返す。
 *
 * プライベートブラウジングや設定でストレージが無効な環境では、参照した時点で
 * 例外になることがある。退避が使えないだけで通常どおり使えるようにするため、
 * ここで握って null を返す（J-6）。
 */
export function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    // 参照だけで落ちる環境がある。理由は出すが値は出さない
    console.warn("[customer-info-draft] localStorage を利用できません");
    return null;
  }
}

/** 退避する。失敗しても入力操作を妨げない */
export function saveCustomerInfoDraft(
  storage: Storage | null,
  draft: CustomerInfoDraft,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(customerInfoDraftKey(draft.recordId), JSON.stringify(draft));
    return true;
  } catch {
    // 容量超過・書き込み禁止など。退避データの中身は出さない
    console.warn("[customer-info-draft] 入力内容の退避に失敗しました");
    return false;
  }
}

export function clearCustomerInfoDraft(
  storage: Storage | null,
  recordId: string,
): void {
  if (!storage) return;
  try {
    storage.removeItem(customerInfoDraftKey(recordId));
  } catch {
    console.warn("[customer-info-draft] 退避データの削除に失敗しました");
  }
}

/**
 * この顧客の退避データを読む。期限切れなら復元候補にせず、その場で削除する。
 */
export function loadCustomerInfoDraft(
  storage: Storage | null,
  recordId: string,
  nowMs: number,
  ttlMs: number = CUSTOMER_INFO_DRAFT_TTL_MS,
): CustomerInfoDraft | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(customerInfoDraftKey(recordId));
  } catch {
    console.warn("[customer-info-draft] 退避データの読み込みに失敗しました");
    return null;
  }

  const draft = parseCustomerInfoDraft(raw);
  if (!draft) {
    // 壊れている・形式が古い。残しておく理由がない
    if (raw !== null) clearCustomerInfoDraft(storage, recordId);
    return null;
  }
  if (isCustomerInfoDraftExpired(draft, nowMs, ttlMs)) {
    clearCustomerInfoDraft(storage, recordId);
    return null;
  }
  return draft;
}

/**
 * 期限切れの退避データを、他の顧客の分も含めてまとめて削除する（J-5）。
 * キーの前方一致で走査する。削除した件数を返す。
 */
export function purgeExpiredCustomerInfoDrafts(
  storage: Storage | null,
  nowMs: number,
  ttlMs: number = CUSTOMER_INFO_DRAFT_TTL_MS,
): number {
  if (!storage) return 0;
  try {
    const targets: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key || !key.startsWith(CUSTOMER_INFO_DRAFT_KEY_PREFIX)) continue;
      const draft = parseCustomerInfoDraft(storage.getItem(key));
      // 壊れているものも掃除の対象にする
      if (!draft || isCustomerInfoDraftExpired(draft, nowMs, ttlMs)) {
        targets.push(key);
      }
    }
    for (const key of targets) storage.removeItem(key);
    return targets.length;
  } catch {
    console.warn("[customer-info-draft] 期限切れ退避データの掃除に失敗しました");
    return 0;
  }
}

/**
 * 退避した日時の表示（例: `8/10 15:32`）。
 * いつの入力か分からないと復元するかを判断できないため必ず出す。
 * 端末のタイムゾーン設定に左右されないよう Asia/Tokyo で固定する。
 */
export function formatCustomerInfoDraftSavedAt(savedAtMs: number): string {
  if (!Number.isFinite(savedAtMs)) return "";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(savedAtMs));

  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const month = pick("month");
  const day = pick("day");
  const hour = pick("hour").padStart(2, "0");
  const minute = pick("minute").padStart(2, "0");
  if (!month || !day) return "";
  return `${month}/${day} ${hour}:${minute}`;
}
