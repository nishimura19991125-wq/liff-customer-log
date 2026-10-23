import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "施工カレンダー",
};

export default function CalendarLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
