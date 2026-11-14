"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";

export interface CirclesProps {
  /** Array of rows, where each row is an array of image URLs */
  rows?: string[][];
  earnings?: string[][];
  /** Size of each circle/image in pixels */
  circleSize?: number;
  /** Base radius for the first orbit in pixels */
  baseRadius?: number;
  /** Gap between each orbit ring in pixels */
  orbitGap?: number;
  /** Duration of one complete rotation in seconds */
  rotationDuration?: number;
  /** Delay between each row's animation start in seconds */
  rowDelay?: number;
  /** Direction of rotation */
  direction?: "clockwise" | "counterclockwise";
  /** Alternate direction for each row */
  alternateDirection?: boolean;
  /** Fade mode for rows - 'in' fades from outside to inside, 'out' fades from inside to outside */
  fadeMode?: "in" | "out" | "none";
  /** Apply incremental blur along with fade */
  fadeBlur?: boolean;
  /** Show dashed orbital paths */
  showPaths?: boolean;
  /** Enable entrance animation on mount */
  animate?: boolean;
  /** Duration of entrance animation in seconds */
  animationDuration?: number;
  /** Stagger delay between each row's entrance in seconds */
  animationStagger?: number;
  /** Scale factor for each additional row - negative values shrink outer rows, positive values grow them */
  staggerScaleFactor?: number;
  /** Additional CSS classes for the container */
  className?: string;
}

const Circles: React.FC<CirclesProps> = ({
  rows = [
    [
      "/referral-portraits/portrait-sienna.webp",
      "/referral-portraits/portrait-indigo.webp",
    ],
    [
      "/referral-portraits/portrait-olive.webp",
      "/referral-portraits/portrait-silver.webp",
      "/referral-portraits/portrait-ochre.webp",
    ],
    [
      "/referral-portraits/portrait-rose.webp",
      "/referral-portraits/portrait-teal.webp",
      "/referral-portraits/portrait-pearl.webp",
      "/referral-portraits/portrait-sienna.webp",
    ],
  ],
  earnings = [],
  circleSize = 48,
  baseRadius = 120,
  orbitGap = 100,
  rotationDuration = 20,
  rowDelay = 0.5,
  direction = "clockwise",
  alternateDirection = false,
  fadeMode = "none",
  fadeBlur = false,
  showPaths = true,
  animate = true,
  animationDuration = 0.6,
  animationStagger = 0.15,
  staggerScaleFactor = 0,
  className,
}) => {
  const stableRows = useMemo(() => {
    return rows.map((row) => [...row]);
  }, [rows]);

  const maxRadius = baseRadius + (stableRows.length - 1) * orbitGap;
  const containerSize = (maxRadius + circleSize) * 2;

  return (
    <div
      className={cn("relative", className)}
      style={{
        width: `${containerSize}px`,
        height: `${containerSize}px`,
        animation: animate
          ? "circles-container-fade-in 0.8s ease-out"
          : undefined,
      }}
    >
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        {showPaths && (
          <svg
            className="absolute left-1/2 top-1/2 pointer-events-none"
            style={{
              width: `${containerSize}px`,
              height: `${containerSize}px`,
              transform: "translate(-50%, -50%)",
            }}
          >
            {stableRows.map((_, rowIndex) => {
              const radius = baseRadius + rowIndex * orbitGap;
              return (
                <circle
                  key={rowIndex}
                  cx="50%"
                  cy="50%"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeDasharray="12 10"
                  className="stroke-gray-300 dark:stroke-gray-700"
                  style={{
                    opacity: 0.8,
                    animation: animate
                      ? `circles-path-entrance ${animationDuration}s ease-out ${rowIndex * animationStagger}s backwards`
                      : undefined,
                  }}
                />
              );
            })}
          </svg>
        )}

        {stableRows.map((row, rowIndex) => {
          const radius = baseRadius + rowIndex * orbitGap;
          const ringDuration = rotationDuration + rowIndex * rowDelay;

          let rowDirection = direction;
          if (alternateDirection && rowIndex % 2 === 1) {
            rowDirection =
              direction === "clockwise" ? "counterclockwise" : "clockwise";
          }
          const animationDirection =
            rowDirection === "clockwise" ? "normal" : "reverse";

          return (
            <ul
              key={rowIndex}
              className="absolute left-1/2 top-1/2 list-none p-0 m-0 rounded-full"
              style={{
                width: `${radius * 2}px`,
                height: `${radius * 2}px`,
                transform: "translate(-50%, -50%)",
                animation: `circles-orbit-${rowIndex} ${ringDuration}s linear infinite ${animationDirection}`,
              }}
            >
              {row.map((imageUrl, circleIndex) => {
                const angle = ((360 / row.length) * circleIndex - 90) % 360;
                const scaledCircleSize =
                  circleSize * (1 + rowIndex * staggerScaleFactor);

                return (
                  <li
                    key={circleIndex}
                    className="absolute block left-1/2 top-1/2"
                    style={
                      {
                        width: `${scaledCircleSize}px`,
                        height: `${scaledCircleSize}px`,
                        margin: `-${scaledCircleSize / 2}px`,
                        transform: `rotate(${angle}deg) translateX(${radius}px)`,
                        "--item-angle": `${angle}deg`,
                        "--entrance-delay": `${rowIndex * animationStagger}s`,
                        "--target-opacity":
                          fadeMode === "in"
                            ? 0.2 + (rowIndex / (stableRows.length - 1)) * 0.8
                            : fadeMode === "out"
                              ? 0.2 +
                                ((stableRows.length - rowIndex - 1) /
                                  (stableRows.length - 1)) *
                                  0.8
                              : 1,
                        "--target-blur":
                          fadeBlur && fadeMode !== "none"
                            ? fadeMode === "in"
                              ? `${((stableRows.length - rowIndex - 1) / (stableRows.length - 1)) * 8}px`
                              : `${(rowIndex / (stableRows.length - 1)) * 8}px`
                            : "0px",
                      } as React.CSSProperties
                    }
                  >
                    <div
                      className="relative w-full h-full"
                      style={{
                        animation: animate
                          ? `circles-entrance-${rowIndex} ${animationDuration}s cubic-bezier(0.34, 1.56, 0.64, 1) ${rowIndex * animationStagger}s both, circles-counter-orbit-${rowIndex} ${ringDuration}s linear infinite ${rowIndex * animationStagger}s ${animationDirection}`
                          : `circles-counter-orbit-${rowIndex} ${ringDuration}s linear infinite ${animationDirection}`,
                      }}
                    >
                      <img
                        src={imageUrl}
                        alt={`Circle ${rowIndex}-${circleIndex}`}
                        className="w-full h-full rounded-full object-cover shadow-lg border-2 border-white dark:border-gray-800"
                        loading="eager"
                      />
                      {earnings[rowIndex]?.[circleIndex] && <span className="wpay-referral-earning">{earnings[rowIndex][circleIndex]}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          );
        })}
      </div>

      <style>{`
        @keyframes circles-container-fade-in {
          0% {
            opacity: 0;
          }
          100% {
            opacity: 1;
          }
        }

        @keyframes circles-path-entrance {
          0% {
            opacity: 0;
            stroke-dashoffset: 100;
          }
          100% {
            opacity: 0.5;
            stroke-dashoffset: 0;
          }
        }

        ${stableRows
          .map(
            (_, rowIndex) => `
          @keyframes circles-orbit-${rowIndex} {
            from {
              transform: translate(-50%, -50%) rotate(0deg);
            }
            to {
              transform: translate(-50%, -50%) rotate(360deg);
            }
          }

          @keyframes circles-counter-orbit-${rowIndex} {
            0% {
              transform: rotate(calc(-1 * var(--item-angle))) scale(1);
              opacity: ${
                fadeMode === "in"
                  ? 0.2 + (rowIndex / (stableRows.length - 1)) * 0.8
                  : fadeMode === "out"
                    ? 0.2 +
                      ((stableRows.length - rowIndex - 1) /
                        (stableRows.length - 1)) *
                        0.8
                    : 1
              };
              filter: ${
                fadeBlur && fadeMode !== "none"
                  ? fadeMode === "in"
                    ? `blur(${((stableRows.length - rowIndex - 1) / (stableRows.length - 1)) * 8}px)`
                    : `blur(${(rowIndex / (stableRows.length - 1)) * 8}px)`
                  : "none"
              };
            }
            100% {
              transform: rotate(calc(-1 * var(--item-angle) - 360deg)) scale(1);
              opacity: ${
                fadeMode === "in"
                  ? 0.2 + (rowIndex / (stableRows.length - 1)) * 0.8
                  : fadeMode === "out"
                    ? 0.2 +
                      ((stableRows.length - rowIndex - 1) /
                        (stableRows.length - 1)) *
                        0.8
                    : 1
              };
              filter: ${
                fadeBlur && fadeMode !== "none"
                  ? fadeMode === "in"
                    ? `blur(${((stableRows.length - rowIndex - 1) / (stableRows.length - 1)) * 8}px)`
                    : `blur(${(rowIndex / (stableRows.length - 1)) * 8}px)`
                  : "none"
              };
            }
          }

          @keyframes circles-entrance-${rowIndex} {
            0% {
              opacity: 0;
              transform: rotate(calc(-1 * var(--item-angle))) scale(0.6);
              filter: blur(10px) ${
                fadeBlur && fadeMode !== "none"
                  ? fadeMode === "in"
                    ? `blur(${((stableRows.length - rowIndex - 1) / (stableRows.length - 1)) * 8}px)`
                    : `blur(${(rowIndex / (stableRows.length - 1)) * 8}px)`
                  : ""
              };
            }
            60% {
              filter: ${
                fadeBlur && fadeMode !== "none"
                  ? fadeMode === "in"
                    ? `blur(${((stableRows.length - rowIndex - 1) / (stableRows.length - 1)) * 8}px)`
                    : `blur(${(rowIndex / (stableRows.length - 1)) * 8}px)`
                  : "blur(0px)"
              };
            }
            100% {
              opacity: ${
                fadeMode === "in"
                  ? 0.2 + (rowIndex / (stableRows.length - 1)) * 0.8
                  : fadeMode === "out"
                    ? 0.2 +
                      ((stableRows.length - rowIndex - 1) /
                        (stableRows.length - 1)) *
                        0.8
                    : 1
              };
              transform: rotate(calc(-1 * var(--item-angle))) scale(1);
              filter: ${
                fadeBlur && fadeMode !== "none"
                  ? fadeMode === "in"
                    ? `blur(${((stableRows.length - rowIndex - 1) / (stableRows.length - 1)) * 8}px)`
                    : `blur(${(rowIndex / (stableRows.length - 1)) * 8}px)`
                  : "blur(0px)"
              };
            }
          }
        `,
          )
          .join("\n")}
      `}</style>
    </div>
  );
};

Circles.displayName = "Circles";

export default Circles;
