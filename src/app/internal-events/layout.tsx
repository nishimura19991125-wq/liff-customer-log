import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "社内イベント",
};

export default function InternalEventsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
