export default function StartupWordmark() {
  return (
    <div
      className="wpay-startup-wordmark pointer-events-none absolute left-1/2 z-[2] w-[132px] -translate-x-1/2"
      style={{
        width: 132,
        aspectRatio: "282 / 116",
        top: "calc(max(24px, env(safe-area-inset-top, 0px), var(--tg-safe-area-inset-top, 0px)) + var(--tg-content-safe-area-inset-top, 0px) + 16px)",
      }}
    >
      <img
        className="wpay-lock-wordmark block h-auto w-full dark:hidden"
        src="/brands/wpay-wordmark.svg"
        width={282}
        height={116}
        alt="wPay"
      />
      <img
        className="wpay-lock-wordmark hidden h-auto w-full dark:block"
        src="/brands/wpay-wordmark-light.svg"
        width={282}
        height={116}
        alt="wPay"
      />
    </div>
  );
}
