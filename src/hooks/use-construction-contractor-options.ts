"use client";

import { useEffect, useState } from "react";

/**
 * 施工会社（取引先会社一覧）の選択肢。
 *
 * 新規登録パネルにあった取得処理を、新規登録の「未定案件を割り当て」
 * （タスクS）と共用するために切り出した。振る舞いは元のまま。
 */

export type ContractorOptionsState = {
  options: string[];
  loading: boolean;
  /** 取引先会社一覧を引けているか。false のときは環境変数の設定不足 */
  configured: boolean;
};

const EMPTY_OPTIONS: string[] = [];

const IDLE: ContractorOptionsState = {
  options: EMPTY_OPTIONS,
  loading: false,
  configured: false,
};

const LOADING: ContractorOptionsState = {
  options: EMPTY_OPTIONS,
  loading: true,
  configured: false,
};

export function useConstructionContractorOptions(
  idToken: string | null,
  active: boolean,
): ContractorOptionsState {
  const key = active && idToken ? idToken : "";
  const [loaded, setLoaded] = useState<{
    key: string;
    state: ContractorOptionsState;
  } | null>(null);

  useEffect(() => {
    if (!key) return;

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/calendar/construction-contractors", {
          headers: { Authorization: `Bearer ${key}` },
        });
        const data = (await res.json()) as {
          options?: string[];
          configured?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setLoaded({ key, state: IDLE });
          return;
        }
        setLoaded({
          key,
          state: {
            options: data.options ?? EMPTY_OPTIONS,
            loading: false,
            configured: data.configured !== false,
          },
        });
      } catch {
        if (!cancelled) setLoaded({ key, state: IDLE });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!key) return IDLE;
  return loaded?.key === key ? loaded.state : LOADING;
}
