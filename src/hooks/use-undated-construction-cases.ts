"use client";

import { useEffect, useState } from "react";

import type {
  UndatedConstructionCase,
  UndatedConstructionCasesPayload,
} from "@/lib/calendar-api-types";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";

/**
 * 工事日未定案件の一覧取得。
 *
 * 空き枠カードの「未定案件を割り当て」と、新規登録の「未定案件を割り当て」
 * （タスクS）で同じ一覧を使うため、取得部分だけを切り出した。
 *
 * 取得結果は取得時の idToken をキーとして持つ。active が false になったら
 * 状態を書き換えずに IDLE を返すだけにして、エフェクト内での同期的な
 * setState（カスケード再描画）を避けている。
 */

export type UndatedCasesStatus = "idle" | "loading" | "ok" | "err";

export type UndatedCasesState = {
  status: UndatedCasesStatus;
  cases: UndatedConstructionCase[];
  myCases: UndatedConstructionCase[];
  error: string;
  needsStaffBind: boolean;
};

const EMPTY_CASES: UndatedConstructionCase[] = [];

const IDLE: UndatedCasesState = {
  status: "idle",
  cases: EMPTY_CASES,
  myCases: EMPTY_CASES,
  error: "",
  needsStaffBind: false,
};

const LOADING: UndatedCasesState = { ...IDLE, status: "loading" };

function errorState(error: string): UndatedCasesState {
  return { ...IDLE, status: "err", error };
}

export function useUndatedConstructionCases(
  idToken: string | null,
  active: boolean,
  onSessionExpired?: () => void,
): UndatedCasesState {
  /** 取得の単位。閉じているときは空文字＝取得しない */
  const key = active && idToken ? idToken : "";
  const [loaded, setLoaded] = useState<{
    key: string;
    state: UndatedCasesState;
  } | null>(null);

  useEffect(() => {
    if (!key) return;

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/calendar/undated-construction-cases", {
          headers: { Authorization: `Bearer ${key}` },
        });
        const data = (await res.json()) as UndatedConstructionCasesPayload & {
          error?: string;
        };
        if (cancelled) return;
        if (res.status === 401 && isLineSessionExpiredPayload(data)) {
          onSessionExpired?.();
          setLoaded({
            key,
            state: errorState(
              "ログインの有効期限が切れました。画面を更新してください。",
            ),
          });
          return;
        }
        if (!res.ok) {
          setLoaded({
            key,
            state: errorState(
              typeof data.error === "string"
                ? data.error
                : "工事日未定案件の取得に失敗しました",
            ),
          });
          return;
        }
        const items = data.items ?? [];
        setLoaded({
          key,
          state: {
            status: "ok",
            cases: items,
            myCases: data.myItems ?? items.filter((c) => c.isMyApCl),
            error: "",
            needsStaffBind: Boolean(data.needsStaffBind),
          },
        });
      } catch {
        if (!cancelled) {
          setLoaded({ key, state: errorState("通信に失敗しました") });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key, onSessionExpired]);

  if (!key) return IDLE;
  return loaded?.key === key ? loaded.state : LOADING;
}
