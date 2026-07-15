"use client";

import { BulletinBoard } from "@/components/bulletin-board";
import { InternalEventsLiffFrame } from "@/components/internal-events-liff-frame";

export default function BulletinPage() {
  return (
    <InternalEventsLiffFrame
      title="掲示板"
      subtitle="社内のお知らせを確認します"
      backHref="/"
      backLabel="ホームへ"
    >
      <BulletinBoard />
    </InternalEventsLiffFrame>
  );
}
