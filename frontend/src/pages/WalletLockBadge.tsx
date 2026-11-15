import { lazy, Suspense, useEffect, useState } from "react";
import { getUser } from "../lib/telegram";

const Lanyard = lazy(() => import("../components/reactbits/Lanyard"));

// The badge uses only Telegram's public profile; wallet data stays behind the lock.
function badgeFace(photo: HTMLImageElement | null) {
  const user = getUser();
  const name =
    [user?.first_name, user?.last_name].filter(Boolean).join(" ") || "WPay";
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1440;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const gradient = ctx.createLinearGradient(0, 0, 1024, 1440);
  gradient.addColorStop(0, "#253657");
  gradient.addColorStop(0.5, "#17233b");
  gradient.addColorStop(1, "#0d1425");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 1440);
  ctx.strokeStyle = "#ffffff16";
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(1180, 500, 340 + i * 80, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = "#e2eaff";
  ctx.font = "600 57px system-ui";
  ctx.fillText("WPAY", 94, 240);
  ctx.fillStyle = "#92a4c5";
  ctx.font = "400 23px system-ui";
  ctx.fillText("PERSONAL ACCESS", 96, 292);
  ctx.save();
  ctx.beginPath();
  ctx.arc(512, 650, 240, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#3b5076";
  ctx.fillRect(272, 410, 480, 480);
  if (photo) {
    const scale = Math.max(480 / photo.naturalWidth, 480 / photo.naturalHeight);
    const w = photo.naturalWidth * scale,
      h = photo.naturalHeight * scale;
    ctx.drawImage(photo, 512 - w / 2, 650 - h / 2, w, h);
  } else {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#e8efff";
    ctx.font = "500 180px system-ui";
    ctx.fillText(Array.from(name)[0].toUpperCase(), 512, 658);
  }
  ctx.restore();
  ctx.textAlign = "center";
  ctx.fillStyle = "#f0f4ff";
  ctx.font = "600 62px system-ui";
  ctx.fillText(name, 512, 1070, 830);
  ctx.fillStyle = "#92a4c5";
  ctx.font = "400 30px system-ui";
  ctx.fillText(
    user?.username ? `@${user.username}` : "Ваш личный кошелёк",
    512,
    1130,
    830,
  );
  ctx.fillStyle = "#7494cf";
  ctx.fillRect(452, 1240, 120, 4);
  return canvas.toDataURL("image/png");
}

export default function WalletLockBadge() {
  const [face, setFace] = useState("");
  const user = getUser();
  useEffect(() => {
    let active = true;
    setFace(badgeFace(null));
    if (!user?.photo_url) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!active) return;
      try {
        setFace(badgeFace(img));
      } catch {
        /* Keep initials if the avatar cannot be used in a texture. */
      }
    };
    img.src = user.photo_url;
    return () => {
      active = false;
      img.onload = null;
    };
  }, [user?.photo_url]);
  return (
    <div className="wpay-lock-badge" aria-label="Бейдж профиля">
      <div className="wpay-lock-badge-fallback" aria-hidden="true">
        <span className="wpay-lock-badge-strap" />
        {face && <img src={face} alt="" />}
      </div>
      {face && (
        <Suspense fallback={null}>
          <Lanyard
            frontImage={face}
            backImage={face}
            imageFit="cover"
            cardColor="#17233b"
            strapColor="#253657"
            metal="graphite"
            finish="matte"
            size={0.75}
            strapLength={0.3}
            breeze={0.15}
            damping={0.65}
            interactive
            intro={false}
          />
        </Suspense>
      )}
    </div>
  );
}
