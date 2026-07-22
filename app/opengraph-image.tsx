import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "AgentOS — the wallet your agents actually operate";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The social preview card.
 *
 * Rendered by Next's OG image runtime, which uses Satori — a subset of CSS with
 * no external fonts, no SVG `<rect>` loops worth the size, and flexbox only.
 * The cat is therefore drawn as absolutely-positioned divs from the same pixel
 * map the app uses, so the mascot on X matches the mascot on the site.
 */

const CAT = [
  "..DD........DD..",
  "..DMD......DMD..",
  "..DMMD....DMMD..",
  "..DMMMDDDDMMMD..",
  ".DMMMMMMMMMMMMD.",
  ".DMWPMMMMMMPWMD.",
  ".DMMMMMMMMMMMMD.",
  ".DMMMMMDPDMMMMD.",
  ".DMMMLMMMMLMMMD.",
  "..DMMMLLLLMMMD..",
  "...DDMLLLLMDD...",
  "....DMLLLLMD....",
  "....DMLLLLMD.DD.",
  "....DMLLLLMD.DMD",
  "...DMMDDDDMMDDMD",
  "...DDD....DDDDD.",
];

const COLORS: Record<string, string> = {
  D: "#5c2410",
  M: "#d97757",
  L: "#e8895f",
  W: "#f7ede8",
  P: "#2a1008",
};

export default function OpengraphImage() {
  const px = 11;
  const cells: React.ReactElement[] = [];
  for (let y = 0; y < CAT.length; y++) {
    for (let x = 0; x < CAT[y].length; x++) {
      const fill = COLORS[CAT[y][x]];
      if (!fill) continue;
      cells.push(
        <div
          key={`${x}-${y}`}
          style={{
            position: "absolute",
            left: x * px,
            top: y * px,
            width: px,
            height: px,
            background: fill,
          }}
        />
      );
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#0b0b0d",
          padding: 64,
          position: "relative",
        }}
      >
        {/* The same faint grid the app sits on. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.028) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.028) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            display: "flex",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ position: "relative", width: px * 16, height: px * 16, display: "flex" }}>
            {cells}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {/* Satori requires an explicit display on any node with more than
                one child, so the two-tone wordmark is a flex row, not inline. */}
            <div style={{ display: "flex", fontSize: 62, fontWeight: 700, letterSpacing: -1.5 }}>
              <div style={{ display: "flex", color: "#e6e6ec" }}>Agent</div>
              <div style={{ display: "flex", color: "#d97757" }}>OS</div>
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 20,
                color: "#8f8f9d",
                letterSpacing: 4,
                textTransform: "uppercase",
                marginTop: 6,
              }}
            >
              Wallet for agents
            </div>
          </div>
        </div>

        <div
          style={{
            fontSize: 46,
            color: "#e6e6ec",
            lineHeight: 1.25,
            marginTop: 46,
            maxWidth: 940,
            display: "flex",
          }}
        >
          {"Every AI agent has the same bug. It can do the work — it can't pay for anything."}
        </div>

        <div
          style={{
            fontSize: 26,
            color: "#b8b8c4",
            marginTop: 22,
            maxWidth: 900,
            display: "flex",
          }}
        >
          {"x402 payments settled in USDG. Tokenized stocks on Robinhood Chain. Five agents trading live, right now."}
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: "auto" }}>
          {["402 Payment Required", "EIP-3009 · USDG", "Robinhood Chain", "npx agentos-mcp"].map(
            (chip, i) => (
              <div
                key={chip}
                style={{
                  display: "flex",
                  border: `1px solid ${i === 0 ? "#d9775766" : "#2a2a31"}`,
                  background: i === 0 ? "#d9775714" : "transparent",
                  color: i === 0 ? "#d97757" : "#8f8f9d",
                  padding: "10px 16px",
                  fontSize: 19,
                  borderRadius: 2,
                }}
              >
                {chip}
              </div>
            )
          )}
        </div>
      </div>
    ),
    size
  );
}
