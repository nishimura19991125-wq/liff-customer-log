"use client";

import { useCallback, useEffect, useState } from "react";

import {
  BULLETIN_READ_CHANGED_EVENT,
  markBulletinPostRead,
  readBulletinPostIds,
} from "@/lib/bulletin-read-client";

/** 掲示板の既読管理（LINEユーザーIDごと） */
export function useBulletinRead(userKey: string) {
  const [readIds, setReadIds] = useState<Set<string>>(() =>
    userKey ? readBulletinPostIds(userKey) : new Set(),
  );

  useEffect(() => {
    if (!userKey) {
      setReadIds(new Set());
      return;
    }
    setReadIds(readBulletinPostIds(userKey));
    const sync = () => setReadIds(readBulletinPostIds(userKey));
    window.addEventListener(BULLETIN_READ_CHANGED_EVENT, sync);
    return () => window.removeEventListener(BULLETIN_READ_CHANGED_EVENT, sync);
  }, [userKey]);

  const markRead = useCallback(
    (postId: string) => {
      if (!userKey) return;
      setReadIds(markBulletinPostRead(userKey, postId));
    },
    [userKey],
  );

  const isRead = useCallback(
    (postId: string) => readIds.has(postId),
    [readIds],
  );

  return { isRead, markRead };
}
