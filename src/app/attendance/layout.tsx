import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "勤怠管理",
};

export default function AttendanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
