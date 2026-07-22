import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Shell } from "@/components/Shell";

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
        {/* Mascot as favicon — same pixel map, inlined so there is no asset fetch. */}
        <link
          rel="icon"
          href={`data:image/svg+xml,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect width="16" height="16" fill="#0b0b0d"/><g fill="#d97757"><rect x="6" y="0" width="4" height="1"/><rect x="4" y="1" width="8" height="1"/><rect x="3" y="2" width="10" height="1"/><rect x="2" y="3" width="12" height="4"/><rect x="2" y="7" width="12" height="2"/><rect x="1" y="9" width="14" height="2"/><rect x="2" y="11" width="12" height="2"/><rect x="1" y="13" width="3" height="1"/><rect x="6" y="13" width="4" height="1"/><rect x="12" y="13" width="3" height="1"/></g><g fill="#2a1008"><rect x="4" y="5" width="2" height="2"/><rect x="10" y="5" width="2" height="2"/></g></svg>`
          )}`}
        />
      </head>
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
