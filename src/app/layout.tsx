import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Lekki Peculiar CBT", template: "%s · Lekki Peculiar CBT" },
  description: "Computer-based testing for Lekki Peculiar School",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1e3a8a" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1120" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
