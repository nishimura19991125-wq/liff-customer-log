import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "工事カレンダー",
};

export default function CalendarLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
