import type { Metadata, Viewport } from "next";
import { themeInitScript } from "@/components/theme";
import { brand } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${brand.productName} · ${brand.schoolName}`, template: `%s · ${brand.productName}` },
  description: `Computer-based testing for ${brand.schoolName}`,
};

export const viewport: Viewport = {
  themeColor: "#f5f7fb",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
