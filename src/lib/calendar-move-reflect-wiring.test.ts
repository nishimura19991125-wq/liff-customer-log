import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 移動が画面に出るまでの配線（ソースを直接見る）。
 *
 * 実機で「工事日を変えても5分ほどカレンダーが変わらない」が出た。
 * 原因は2つ重なっていた。
 *   A) refresh=1 が捨てるのは月ペイロードのキャッシュだけで、材料である
 *      工事レコードのキャッシュ（既定300秒）が残っていた
 *   B) 移動は2レコードが変わるので calendarPatch では表せず、
 *      パネルは onSaved(null)＝再取得だけに任せていた
 *
 * ここは文字列一致で「どこへ繋がっているか」を固定する
 * （calendar-move-case-wiring.test.ts と同じ流儀）。組み替えの中身は
 * calendar-apply-case-move.test.ts で挙動として固定している。
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const ROUTE = "src/app/api/calendar/route.ts";
const PAGE = "src/components/liff-calendar-month-page.tsx";
const PANEL = "src/components/calendar-move-case-panel.tsx";

describe("A: refresh=1 で工事レコードのキャッシュも捨てる", () => {
  it("★ refresh のときだけ捨てている", () => {
    const src = read(ROUTE);

    expect(src).toContain("invalidateCalendarConstructionRecordsCache");

    // if (refresh) { ... } の中に入っていること
    const at = src.indexOf("invalidateCalendarConstructionRecordsCache()");
    expect(at).toBeGreaterThan(0);
    const before = src.slice(0, at);
    const guard = before.lastIndexOf("if (refresh)");
    expect(guard).toBeGreaterThan(0);
    // 月ペイロードの破棄と同じブロックにある
    expect(before.slice(guard)).toContain(
      "invalidateCalendarPayloadCacheForMonth",
    );
  });

  it("★ 通常の GET では捨てない（毎回全件取り直しにしない）", () => {
    const src = read(ROUTE);

    // 呼び出しは1か所だけ。増えていたら refresh 以外から捨てている疑い
    const calls = src.match(/invalidateCalendarConstructionRecordsCache\(\)/g);
    expect(calls).toHaveLength(1);
  });
});

describe("B/C: 移動の即時反映", () => {
  it("★ パネルは移動専用の反映を呼ぶ（onSaved(null) だけに任せない）", () => {
    const src = read(PANEL);

    expect(src).toContain("onMoved");
    expect(src).toContain("caseRecordId: recordId");
    expect(src).toContain("slotRecordId: usedSlotId || null");
    // 新規作成のときはサーバが返したレコードIDを使う
    expect(src).toContain("movedRecordId: data.recordId?.trim() || null");
  });

  it("★ 画面側は byDay を組み替えてから再取得する", () => {
    const src = read(PAGE);

    expect(src).toContain("onMoved={applyCaseMoveToView}");
    expect(src).toContain("applyCalendarCaseMove(prev, move)");
    // 組み替えたあとに正の値へ置き換える
    const at = src.indexOf("const applyCaseMoveToView");
    expect(src.slice(at)).toContain("await forceRefreshCalendar();");
  });

  it("★ C: 移動先の日へ選択を移す（表示中の月にあるときだけ）", () => {
    const src = read(PAGE);
    const body = src.slice(src.indexOf("const applyCaseMoveToView"));

    expect(body).toContain("setSelectedDayKey(move.targetDayKey)");
    expect(body).toContain("dayKeyInMonth(move.targetDayKey");
  });

  it("★ 他の経路の即時反映は従来どおり（patch を使う経路を壊さない）", () => {
    const src = read(PAGE);

    expect(src).toContain("applyCalendarRecordPatch(prev, patch)");
    expect(src).toContain("onSaved={applyCalendarSaveToView}");
  });
});
