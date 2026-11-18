"use client";

import Galaxy from "./Galaxy";

export function GalaxyBackground() {
  return (
    <div className="eba-dashboard-galaxy" aria-hidden="true">
      <Galaxy
        density={1}
        glowIntensity={0.3}
        flareIntensity={1}
        starSpeed={0.5}
        mouseRepulsion
        clickWarp
        starColors={[]}
        hueShift={140}
        saturation={0}
        starSize={1}
        twinkleIntensity={0.3}
        speed={1}
        rotationSpeed={0.1}
        layers={4}
        direction="forward"
        repulsionStrength={2}
        mouseInteraction
        intro
        lightMode
      />
    </div>
  );
}
