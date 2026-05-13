"use client";

import liff from "@line/liff";
import { useCallback, useEffect, useState } from "react";

import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";
import { LIFF_PROFILE_CACHE_KEY } from "@/lib/liff-profile-cache-key";

type StaffApiPayload = {
  staff?: { id: string; name: string; importKey?: string }[];
  boundStaff?: { id: string; name: string } | null;
  lineUserId?: string;
  bindingEnabled?: boolean;
};

/** LIFF プロフィール取得（セッションキャッシュ）＋スタッフ名簿との紐付け API */
export function useLiffAccountStrip(idToken: string | null, enabled: boolean) {
  const [loading, setLoading] = useState(Boolean(enabled && idToken));
  const [displayName, setDisplayName] = useState("");
  const [pictureUrl, setPictureUrl] = useState("");
  const [lineUserId, setLineUserId] = useState("");
  const [boundStaffName, setBoundStaffName] = useState<string | null>(null);
  const [staff, setStaff] = useState<{ id: string; name: string; importKey?: string }[]>([]);
  const [bindingEnabled, setBindingEnabled] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    if (!enabled || !idToken) {
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setSessionExpired(false);
      try {
        try {
          const raw = sessionStorage.getItem(LIFF_PROFILE_CACHE_KEY);
          if (raw) {
            const j = JSON.parse(raw) as {
              displayName?: string;
              pictureUrl?: string;
              userId?: string;
            };
            if (j.displayName && j.userId && !cancelled) {
              setDisplayName(j.displayName);
              setPictureUrl(j.pictureUrl ?? "");
              setLineUserId(j.userId);
            }
          }
        } catch {
          /* ignore */
        }

        const profile = await liff.getProfile();
        if (cancelled) return;
        setDisplayName(profile.displayName);
        setPictureUrl(profile.pictureUrl ?? "");
        setLineUserId(profile.userId);
        try {
          sessionStorage.setItem(
            LIFF_PROFILE_CACHE_KEY,
            JSON.stringify({
              displayName: profile.displayName,
              pictureUrl: profile.pictureUrl,
              userId: profile.userId,
            }),
          );
        } catch {
          /* ignore */
        }

        const res = await fetch("/api/staff", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = (await res.json()) as StaffApiPayload;
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 401 && isLineSessionExpiredPayload(data)) {
            setSessionExpired(true);
          }
          setStaff([]);
          setBindingEnabled(false);
          setBoundStaffName(null);
          return;
        }
        setStaff(data.staff ?? []);
        setBindingEnabled(Boolean(data.bindingEnabled));
        setBoundStaffName(data.boundStaff?.name ? data.boundStaff.name : null);
      } catch {
        if (!cancelled) {
          setBoundStaffName(null);
          setStaff([]);
          setBindingEnabled(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, idToken]);

  const bindStaff = useCallback(
    async (
      staffRecordId: string,
      staffImportKey?: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!idToken) {
        return { ok: false, error: "ログイン情報がありません" };
      }
      try {
        const trimmedKey = staffImportKey?.trim();
        const res = await fetch("/api/staff/bind", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            staffRecordId,
            ...(trimmedKey
              ? { staffImportKeyValue: trimmedKey }
              : {}),
          }),
        });
        const payload = (await res.json()) as {
          ok?: boolean;
          error?: string;
          boundStaff?: { name?: string };
        };
        if (!res.ok) {
          if (res.status === 401 && isLineSessionExpiredPayload(payload)) {
            setSessionExpired(true);
            return {
              ok: false,
              error:
                typeof payload.error === "string"
                  ? payload.error
                  : "ログインの有効期限が切れました",
            };
          }
          return {
            ok: false,
            error:
              typeof payload.error === "string"
                ? payload.error
                : "紐付けに失敗しました",
          };
        }
        const n = payload.boundStaff?.name?.trim();
        if (n) setBoundStaffName(n);
        return { ok: true };
      } catch {
        return { ok: false, error: "通信に失敗しました" };
      }
    },
    [idToken],
  );

  return {
    loading,
    displayName,
    pictureUrl,
    lineUserId,
    boundStaffName,
    staff,
    bindingEnabled,
    bindStaff,
    sessionExpired,
  };
}
