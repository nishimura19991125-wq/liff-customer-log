import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "アポ情報一覧",
};

export default function ApoListLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
