import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { SITE_URL } from "@/config/site";
import { provider } from "@/lib/docs/ui";
import "./docs.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Beezping Documentation",
    template: "%s — Beezping Docs",
  },
  description: "Every option, default, and behavior of the Beezping feedback widget — verified against the source.",
};

// Root layout of the docs route group: unlike the landing (fixed dark), the
// docs let Fumadocs drive light/dark theming, so it needs its own <html>.
export default async function DocsRootLayout({
  params,
  children,
}: {
  params: Promise<{ lang: string }>;
  children: ReactNode;
}) {
  const { lang } = await params;

  return (
    <html lang={lang} className={inter.variable} suppressHydrationWarning>
      <body>
        <RootProvider i18n={provider(lang)}>{children}</RootProvider>
      </body>
    </html>
  );
}
