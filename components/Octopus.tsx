/**
 * The AgentOS mascot.
 *
 * Authored as a 16×16 pixel map rather than drawn paths — the grid is the brand,
 * and keeping it as data means the same source renders the favicon, the nav
 * badge and the hero at any size without ever going soft.
 *
 *   . transparent   D outline   M body   L highlight   W eye white   P pupil
 */
const MAP = [
  "......DDDD......",
  "....DDLLLLDD....",
  "...DLLLLLLLLD...",
  "..DLLLLLLLLLLD..",
  "..DLLLLLLLLLLD..",
  "..DMWWMMMMWWMD..",
  "..DMWPMMMMPWMD..",
  "..DMMMMMMMMMMD..",
  "..DMMMDDDDMMMD..",
  ".DMMMMMMMMMMMMD.",
  ".DMMMMMMMMMMMMD.",
  "..DMMDDMMDDMMD..",
  "..DMMDDMMDDMMD..",
  ".DMMD.DMMD.DMMD.",
  ".DDD..DDD..DDD..",
  "................",
] as const;

const PALETTE: Record<string, string> = {
  D: "#5c2410",
  M: "#d97757",
  L: "#e8895f",
  W: "#f7ede8",
  P: "#2a1008",
};

/** Muted variant for inactive nav states — same silhouette, no colour claim. */
const MUTED: Record<string, string> = {
  D: "#232329",
  M: "#4a4a55",
  L: "#5a5a66",
  W: "#8f8f9d",
  P: "#232329",
};

export function Octopus({
  size = 32,
  muted = false,
  className = "",
  title,
}: {
  size?: number;
  muted?: boolean;
  className?: string;
  title?: string;
}) {
  const palette = muted ? MUTED : PALETTE;
  const cells: React.ReactElement[] = [];

  for (let y = 0; y < MAP.length; y++) {
    const row = MAP[y];
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      const fill = palette[c];
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
 * Hero treatment: the mascot over its own soft glow, bobbing.
 * The glow is the one place in the system where light bleeds past a pixel edge.
 */
export function OctopusHero({ size = 96 }: { size?: number }) {
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
      <Octopus size={size} className="relative animate-bob" title="AgentOS" />
    </div>
  );
}
