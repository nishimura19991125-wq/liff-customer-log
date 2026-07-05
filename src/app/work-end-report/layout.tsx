import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "稼働終了報告",
};

export default function WorkEndReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
