/**
 * Deterministic pixel avatars, GitHub-identicon style.
 *
 * Everyone who joins gets a unique 5×5 pixel face derived entirely from their
 * address — no storage, no upload, no generation step. The same address always
 * produces the same avatar on every device and every render, which is what makes
 * it usable as an identity cue in a leaderboard.
 *
 * Mirrored down the vertical axis because symmetry is what makes an otherwise
 * random blob read as a *face* rather than noise.
 */

/** FNV-1a. Small, fast, and well-distributed across the low bits we index with. */
function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // XOR in JS yields a signed int — force unsigned or every modulo below can
  // come back negative and index off the front of the palette.
  return h >>> 0;
}

/**
 * Hues chosen to sit alongside the brand orange without clashing with the five
 * agent colours, so a visitor never looks like they *are* one of the agents.
 */
const PALETTE = [
  "#d97757", "#e8895f", "#3ecf8e", "#7aa2f7", "#bb9af7",
  "#e5b567", "#5fd3c4", "#f2828f", "#9ece6a", "#ff9e64",
  "#7dcfff", "#c0a5f5", "#f7768e", "#73daca", "#e0af68",
];

export function identiconColor(seed: string): string {
  return PALETTE[hash32(`${seed}:hue`) % PALETTE.length];
}

export function Identicon({
  seed,
  size = 32,
  className = "",
  title,
}: {
  seed: string;
  size?: number;
  className?: string;
  title?: string;
}) {
  const key = (seed || "anon").toLowerCase();
  const color = identiconColor(key);
  const cells: React.ReactElement[] = [];

  // Only the left three columns are decided; the right two mirror them.
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 5; y++) {
      const on = hash32(`${key}:${x}:${y}`) % 100 < 47;
      if (!on) continue;
      cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} />);
      if (x < 2)
        cells.push(<rect key={`${4 - x}-${y}`} x={4 - x} y={y} width={1} height={1} fill={color} />);
    }
  }

  return (
    <svg
      viewBox="-0.5 -0.5 6 6"
      width={size}
      height={size}
      className={`pixelated ${className}`}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      shapeRendering="crispEdges"
    >
      {title ? <title>{title}</title> : null}
      <rect x={-0.5} y={-0.5} width={6} height={6} fill="#101013" />
      {cells}
    </svg>
  );
}
