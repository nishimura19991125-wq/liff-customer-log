import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "掲示板",
};

export default function BulletinLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
