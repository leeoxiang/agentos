import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Shell } from "@/components/Shell";
import { catFaviconDataUri } from "@/components/Cat";

export const metadata: Metadata = {
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
      "x402 payments, stablecoin settlement, tokenized-stock swaps and autonomous trading on Robinhood Chain.",
    type: "website",
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
