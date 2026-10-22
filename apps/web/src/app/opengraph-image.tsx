import { ImageResponse } from "next/og";

export const alt = "MEZONK: trade Yes or No on questions with public rules. Built on Mezo, settled in MUSD.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The Seam mark and wordmark as paths (same geometry as components/brand/Logo.tsx), so no font is needed for them.
const LETTERS: Array<[number, string]> = [
  [0, "M0 40V0H8.5L22 22L35.5 0H44V40H37V13L24.5 33H19.5L7 13V40Z"],
  [51, "M0 0H28V7H7V16.5H25V23.5H7V33H28V40H0Z"],
  [86, "M0 0H30V7L10.5 33H30V40H0V33L19.5 7H0Z"],
  [123, "M9 0H27A9 9 0 0 1 36 9V31A9 9 0 0 1 27 40H9A9 9 0 0 1 0 31V9A9 9 0 0 1 9 0ZM9 7A2 2 0 0 0 7 9V31A2 2 0 0 0 9 33H27A2 2 0 0 0 29 31V9A2 2 0 0 0 27 7Z"],
  [166, "M0 0H7.5L27 27V0H34V40H26.5L7 13V40H0Z"],
  [207, "M0 0H7V17L25 0H34L15 18.5L34 40H25L10.5 23.5L7 26.5V40H0Z"],
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#080A0E", padding: "100px" }}>
        <svg width={920} height={163} viewBox="0 0 317 56">
          <g transform="scale(.875)">
            <path fill="#F4F5F8" d="M0 0H64V32H44V22H18V36H0Z" />
            <path fill="#528DFE" d="M0 64H64V36H40V26H22V40H0Z" />
          </g>
          <g transform="translate(76 8)" fill="#F4F5F8">
            {LETTERS.map(([x, d]) => (
              <path key={x} d={d} transform={`translate(${x} 0)`} fillRule="evenodd" />
            ))}
          </g>
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", fontSize: 46, color: "#F4F5F8", letterSpacing: "-0.02em" }}>
            Trade&nbsp;<span style={{ color: "#528DFE" }}>Yes</span>&nbsp;or No on questions with public rules.
          </div>
          <div style={{ display: "flex", fontSize: 28, color: "#8C939F" }}>Built on Mezo. Settled in MUSD.</div>
        </div>
      </div>
    ),
    size,
  );
}
