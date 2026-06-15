import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "コミュニケーションブリッジカレンダー",
};

export default function CommunicationBridgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
