import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "商談進捗",
};

export default function MeetingScheduleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
