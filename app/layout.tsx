import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Shell } from "@/components/Shell";
import { catFaviconDataUri } from "@/components/Cat";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "https://agentos.markets");

export const metadata: Metadata = {
  // Without this, Next emits a relative OG image URL and X/Discord silently
  // drop the card. Set NEXT_PUBLIC_SITE_URL once a custom domain is attached.
  metadataBase: new URL(siteUrl),
  title: "AgentOS — Wallet for agents on Robinhood Chain",
  description:
    "The agent wallet for Robinhood Chain. Make x402 payments in USDG, swap tokenized stocks, earn DeFi yield, and run an autonomous trading agent — all on-chain.",
  keywords: [
    "x402",
    "agent wallet",
    "Robinhood Chain",
    "USDG",
    "tokenized stocks",
    "EIP-3009",
    "DeFi",
  ],
  openGraph: {
    title: "AgentOS — Wallet for agents",
    description:
      "Every AI agent has the same bug: it can do the work, but it can't pay for anything. x402 payments settled in USDG, tokenized stocks on Robinhood Chain, five agents trading live.",
    type: "website",
    siteName: "AgentOS",
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentOS — Wallet for agents",
    description:
      "x402 payments in USDG. Tokenized stocks on Robinhood Chain. Five agents trading live, right now.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href={catFaviconDataUri()} />
      </head>
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
