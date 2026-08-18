"use client";

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { LiffPrimaryButton } from "@/components/liff-chrome";

export type CustomerInfoSaveFeedback = {
  kind: "ok" | "err";
  text: string;
  savedAt?: string;
  /**
   * 保存自体は成功したが、付随処理に失敗したときの警告（タスクR の契約速報など）。
   * 緑の成功メッセージとは別枠・別色で出す。
   */
  warning?: string;
};

type CustomerInfoSaveBarProps = {
  saving: boolean;
  disabled: boolean;
  feedback: CustomerInfoSaveFeedback | null;
  onSave: () => void;
};

/**
 * ソフトキーボードが出たと見なす visualViewport の縮み幅（px）。
 *
 * iOS のアドレスバー開閉でも 50〜90px 程度は縮むため、それより大きく取る。
 * 小さくするとスクロールのたびに保存バーが消えてちらつく。
 */
const KEYBOARD_HEIGHT_THRESHOLD_PX = 120;

/**
 * 画面下部に固定する保存バー。
 *
 * ── なぜ sticky ではなく fixed + ポータルなのか ─────────────
 * 元は `sticky bottom-0` だったが効いていなかった。理由は2つ。
 *
 *  1. 祖先の LiffCard が `overflow-hidden`。overflow が visible 以外の祖先が
 *     あると、sticky はその要素の内側に閉じ込められ、画面下部に貼り付かない。
 *  2. その LiffCard は `backdrop-blur-md`（backdrop-filter）を持つ。
 *     backdrop-filter は **position: fixed の包含ブロックを作る**ため、
 *     単に fixed へ変えてもカード基準になり画面基準にならない。
 *
 * どちらも LiffCard / LiffScreen という**全画面で共有する**部品の問題で、
 * そこから overflow や backdrop-filter を外すと他画面のレイアウトに
 * 影響が出る。そのため body へポータルして祖先の影響から切り離し、
 * fixed で画面に固定する方式を採った。
 *
 * ── 隠れ防止 ────────────────────────────────────────────
 * ポータルするとバーは通常フローから外れるため、元の位置に同じ高さの
 * スペーサーを残す。これが無いと最後の入力項目がバーの裏に隠れて
 * 操作できなくなる。高さは ResizeObserver で追従する
 * （保存結果のメッセージが出るとバーの高さが変わるため）。
 *
 * ── キーボード ──────────────────────────────────────────
 * iOS の WebView ではキーボード表示中に fixed 要素が入力欄へ覆いかぶさる。
 * visualViewport の縮みでキーボードを検知し、その間はバーを隠す。
 * ただし保存中・保存結果があるときは隠さない。隠すと aria-live の
 * 読み上げ対象ごと DOM から消え、エラーが伝わらなくなるため。
 */
export const CustomerInfoSaveBar = forwardRef<
  HTMLDivElement,
  CustomerInfoSaveBarProps
>(function CustomerInfoSaveBar(
  { saving, disabled, feedback, onSave },
  ref,
) {
  const [mounted, setMounted] = useState(false);
  const [barHeight, setBarHeight] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  /** 外から渡された ref と内部の計測用 ref を両立させる */
  const setBarRef = useCallback(
    (node: HTMLDivElement | null) => {
      barRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // バーの高さをスペーサーへ反映する
  useEffect(() => {
    const node = barRef.current;
    if (!node) return;
    const update = () => setBarHeight(node.offsetHeight);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted, saving, feedback]);

  // ソフトキーボードの表示を検知する
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setKeyboardOpen(
        window.innerHeight - vv.height > KEYBOARD_HEIGHT_THRESHOLD_PX,
      );
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // 保存中・保存結果があるときは隠さない（aria-live を DOM に残す）
  const hidden = keyboardOpen && !saving && !feedback;

  const bar = (
    <div
      ref={setBarRef}
      className={`fixed inset-x-0 bottom-0 z-40 min-w-0 max-w-full border-t border-slate-200/90 bg-white/95 px-4 py-3 shadow-[0_-10px_28px_rgba(15,23,42,0.1)] backdrop-blur-md pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 ${
        hidden ? "hidden" : ""
      }`}
    >
      {saving ? (
        <p
          className="mb-3 rounded-xl bg-slate-100 px-4 py-3 text-center text-[14px] font-bold text-slate-700"
          role="status"
        >
          保存しています…
        </p>
      ) : null}

      {!saving && feedback?.kind === "ok" ? (
        <div
          className="mb-3 rounded-xl border-2 border-emerald-400 bg-emerald-50 px-4 py-3.5 text-center ring-2 ring-emerald-200/80"
          role="status"
          aria-live="polite"
        >
          <p className="text-[17px] font-bold text-emerald-900">
            ✓ 保存できました
          </p>
          <p className="mt-1 text-[13px] font-semibold leading-relaxed text-emerald-800">
            {feedback.text}
            {feedback.savedAt ? `（${feedback.savedAt}）` : ""}
          </p>
        </div>
      ) : null}

      {/*
        保存は成功したが付随処理に失敗したときの警告（タスクR）。
        緑の成功メッセージに紛れ込ませると気づかれないため、別枠・別色で
        直後に出す。読み上げも成功（polite）とは分けて assertive にする。
      */}
      {!saving && feedback?.warning ? (
        <div
          className="mb-3 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3.5"
          role="alert"
          aria-live="assertive"
        >
          <p className="text-[14px] font-bold leading-relaxed text-amber-900">
            ⚠ {feedback.warning}
          </p>
        </div>
      ) : null}

      {!saving && feedback?.kind === "err" ? (
        <div
          className="mb-3 rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3.5"
          role="alert"
          aria-live="assertive"
        >
          <p className="text-[16px] font-bold text-red-800">
            保存できませんでした
          </p>
          <p className="mt-1 text-[13px] font-semibold leading-relaxed text-red-700">
            {feedback.text}
          </p>
        </div>
      ) : null}

      <LiffPrimaryButton
        type="button"
        disabled={disabled || saving}
        onClick={onSave}
      >
        {saving
          ? "保存中…"
          : feedback?.kind === "ok"
            ? "もう一度保存する"
            : "保存して @pocket に反映"}
      </LiffPrimaryButton>
    </div>
  );

  return (
    <>
      {/*
        バーの高さ分の余白。ポータルで通常フローから外れた分をここで埋める。
        キーボードで一時的に隠しているときも高さは維持し、入力中に
        本文が上下へ動かないようにする。
      */}
      <div
        aria-hidden
        className="mt-5"
        style={{ height: barHeight > 0 ? barHeight : undefined }}
      />
      {mounted ? createPortal(bar, document.body) : null}
    </>
  );
});
