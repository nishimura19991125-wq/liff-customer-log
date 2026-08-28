import "server-only";

/**
 * 1リクエストの中で、どの段階に何ミリ秒かかったかをログに出す。
 *
 * 工事日の移動が10秒以上かかった件の調査で、@pocket への往復が
 * 30回以上あることは**コードから数えられた**が、1回あたりの実測が無かった。
 * 推測で削るのを避けるために入れる。
 *
 * ■ 既定では何も出さない
 * CALENDAR_TIMING_LOG=true（または 1）のときだけ出す。無効時は
 * Date.now() すら呼ばない no-op なので、常時有効にしても害が無い作りでは
 * あるが、平常時のログを汚さないよう既定は off にしてある。
 *
 * ■ 個人情報を出さない
 * 出すのは**固定の段階名と数値だけ**。お客様名・T番号・レコードIDは
 * 載せない（レコードIDは業務データと結びつくため、ここでは扱わない）。
 * extra に渡せるのも数値・真偽値・**呼び出し側が固定文字列として書いた値**に
 * 限る前提で、可変の業務データを入れないこと。
 */

export type ServerTimingLog = {
  /** 前の mark からの経過を1段階として記録する */
  mark: (step: string) => void;
  /** 1行にまとめて出す。無効時は何もしない */
  flush: (extra?: Record<string, number | boolean | string>) => void;
  /** 有効かどうか（重い計測を足すかの判断に使える） */
  readonly enabled: boolean;
};

const NOOP: ServerTimingLog = {
  mark: () => {},
  flush: () => {},
  enabled: false,
};

export function serverTimingLogEnabled(): boolean {
  const raw = process.env.CALENDAR_TIMING_LOG?.trim().toLowerCase();
  return raw === "true" || raw === "1";
}

/**
 * @param scope ログの出所（例: "move-construction-case"）。固定文字列にすること
 */
export function startServerTimingLog(scope: string): ServerTimingLog {
  if (!serverTimingLogEnabled()) return NOOP;

  const startedAt = Date.now();
  let previous = startedAt;
  const steps: Record<string, number> = {};

  return {
    enabled: true,
    mark(step: string) {
      const now = Date.now();
      const key = step.trim() || "step";
      // 同じ名前で複数回 mark したら足し込む（ループ内の計測用）
      steps[key] = (steps[key] ?? 0) + (now - previous);
      previous = now;
    },
    flush(extra) {
      const now = Date.now();
      console.info(
        "[timing]",
        JSON.stringify({
          scope,
          totalMs: now - startedAt,
          steps,
          ...(extra ?? {}),
        }),
      );
    },
  };
}
