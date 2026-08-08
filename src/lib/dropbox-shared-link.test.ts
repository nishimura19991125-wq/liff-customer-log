import { describe, expect, it } from "vitest";

import { checkSharedLink } from "@/lib/dropbox";

/**
 * 共有リンクの公開範囲の判定。
 *
 * settings 未指定で作られたリンクがチーム既定に従って外部公開になり、
 * ログアウト状態のブラウザから顧客フォルダの中身が見えていた。
 * その退行を検知するためのテスト。
 */

function link(visibility: string | null, url = "https://example.test/x") {
  return {
    url,
    link_permissions:
      visibility === null
        ? {}
        : { resolved_visibility: { ".tag": visibility } },
  };
}

describe("checkSharedLink", () => {
  it("team_only は使ってよい", () => {
    expect(checkSharedLink(link("team_only"))).toEqual({
      kind: "ok",
      url: "https://example.test/x",
    });
  });

  it("チーム内・フォルダ内に閉じた可視性は使ってよい", () => {
    for (const v of [
      "team_only",
      "team_and_password",
      "shared_folder_only",
      "no_one",
      "only_you",
    ]) {
      expect(checkSharedLink(link(v)).kind).toBe("ok");
    }
  });

  it("public は使わない（今回の事故の状態）", () => {
    expect(checkSharedLink(link("public"))).toEqual({
      kind: "unsafe",
      visibility: "public",
    });
  });

  it("password はチーム外から到達しうるので使わない", () => {
    expect(checkSharedLink(link("password")).kind).toBe("unsafe");
  });

  it("可視性を確認できないときも使わない（フェイルクローズ）", () => {
    expect(checkSharedLink(link(null)).kind).toBe("unsafe");
    expect(checkSharedLink({ url: "https://example.test/x" }).kind).toBe(
      "unsafe",
    );
    expect(
      checkSharedLink({
        url: "https://example.test/x",
        link_permissions: { resolved_visibility: {} },
      }).kind,
    ).toBe("unsafe");
  });

  it("url が読めないときは no-url（可視性の問題と区別する）", () => {
    expect(checkSharedLink(null).kind).toBe("no-url");
    expect(checkSharedLink({}).kind).toBe("no-url");
    expect(checkSharedLink(link("team_only", "   ")).kind).toBe("no-url");
  });

  it("安全でない可視性のときは url を返さない", () => {
    const result = checkSharedLink(link("public"));
    expect(result).not.toHaveProperty("url");
  });
});
