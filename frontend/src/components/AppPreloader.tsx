import type { CSSProperties } from "react";
import "framework7/components/preloader/css";

// Framework7's iOS markup also works before its JS runtime initializes.
// The React wrapper otherwise renders no spinner lines during the first lazy load.
export default function AppPreloader({ size = 28 }: { size?: number }) {
  return (
    <span
      className="ios inline-flex"
      aria-hidden="true"
      style={{ "--f7-preloader-color": "#3783ff" } as CSSProperties}
    >
      <span
        className="preloader"
        style={
          {
            width: size,
            height: size,
            "--f7-preloader-size": `${size}px`,
          } as CSSProperties
        }
      >
        <span className="preloader-inner">
          {Array.from({ length: 8 }, (_, index) => (
            <span key={index} className="preloader-inner-line" />
          ))}
        </span>
      </span>
    </span>
  );
}
