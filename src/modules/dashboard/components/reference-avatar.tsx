import type { CSSProperties } from "react";
/** Only portrait artwork is reused from the reference; dashboard UI is real DOM. */
export function ReferenceAvatar({
  person = 0,
  size = 28,
  profile = false,
}: {
  person?: number;
  size?: number;
  profile?: boolean;
}) {
  const origins = [
    [718, 711],
    [831, 711],
    [942, 711],
    [1054, 711],
  ] as const;
  const [x, y] = profile ? [1322, 9] : origins[person % 4];
  return (
    <span
      className="ref-avatar"
      role="img"
      aria-label="Fictional sample teammate"
      style={
        {
          "--avatar-size": `${size}px`,
          "--avatar-source-size": profile ? 38 : 55,
          "--avatar-x": -x,
          "--avatar-y": -y,
        } as CSSProperties
      }
    />
  );
}
