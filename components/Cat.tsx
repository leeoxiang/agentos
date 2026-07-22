/**
 * The AgentOS mascot.
 *
 * A 16×16 pixel map rather than drawn paths — the grid is the brand, and keeping
 * it as data means one source renders the favicon, the nav badge, the hero and
 * every arena avatar without ever going soft.
 *
 *   . transparent   D outline   M body   L highlight   W eye white   P pupil
 */
const MAP = [
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
] as const;

export type CatPalette = { D: string; M: string; L: string; W: string; P: string };

/** House colours: the brand clay orange. */
export const BRAND: CatPalette = {
  D: "#5c2410",
  M: "#d97757",
  L: "#e8895f",
  W: "#f7ede8",
  P: "#2a1008",
};

/** Muted variant for inactive states — same silhouette, no colour claim. */
const MUTED: CatPalette = {
  D: "#232329",
  M: "#4a4a55",
  L: "#5a5a66",
  W: "#8f8f9d",
  P: "#232329",
};

/**
 * Derive a full palette from one accent colour, so each arena agent gets a
 * visually distinct cat without hand-authoring five colour sets.
 */
export function paletteFrom(hex: string): CatPalette {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const mix = (t: number) =>
    `#${[r, g, b]
      .map((c) => Math.round(t < 0 ? c * (1 + t) : c + (255 - c) * t))
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")}`;
  return { D: mix(-0.62), M: hex, L: mix(0.22), W: "#f7ede8", P: mix(-0.78) };
}

export function Cat({
  size = 32,
  muted = false,
  palette,
  className = "",
  title,
}: {
  size?: number;
  muted?: boolean;
  palette?: CatPalette;
  className?: string;
  title?: string;
}) {
  const colors = palette ?? (muted ? MUTED : BRAND);
  const cells: React.ReactElement[] = [];

  for (let y = 0; y < MAP.length; y++) {
    const row = MAP[y];
    for (let x = 0; x < row.length; x++) {
      const fill = colors[row[x] as keyof CatPalette];
      if (!fill) continue;
      cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />);
    }
  }

  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={`pixelated ${className}`}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      shapeRendering="crispEdges"
    >
      {title ? <title>{title}</title> : null}
      {cells}
    </svg>
  );
}

/**
 * The favicon, generated from the same pixel map.
 *
 * Inlined as a data URI so the tab icon needs no asset fetch, and derived from
 * MAP so the mascot can never drift between the tab and the page.
 */
export function catFaviconDataUri(background = "#0b0b0d"): string {
  const rects: string[] = [];
  for (let y = 0; y < MAP.length; y++) {
    for (let x = 0; x < MAP[y].length; x++) {
      const fill = BRAND[MAP[y][x] as keyof CatPalette];
      if (fill) rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`);
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">` +
    `<rect width="16" height="16" fill="${background}"/>${rects.join("")}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Hero treatment: the mascot over its own soft glow, bobbing.
 * The glow is the one place in the system where light bleeds past a pixel edge.
 */
export function CatHero({ size = 96 }: { size?: number }) {
  return (
    <div className="relative inline-flex items-center justify-center">
      <div
        aria-hidden
        className="absolute rounded-full blur-2xl opacity-40"
        style={{
          width: size * 1.1,
          height: size * 1.1,
          background: "radial-gradient(circle, #d97757 0%, transparent 70%)",
        }}
      />
      <Cat size={size} className="relative animate-bob" title="AgentOS" />
    </div>
  );
}
