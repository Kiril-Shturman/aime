import { lazy, Suspense, useEffect, useState } from "react";
import { getUser } from "../lib/telegram";

const Lanyard = lazy(() => import("../components/reactbits/Lanyard"));

// The badge uses only Telegram's public profile; wallet data stays behind the lock.
function badgeFace(
  photo: HTMLImageElement | null,
  logo: HTMLImageElement | null = null,
) {
  const user = getUser();
  const name =
    [user?.first_name, user?.last_name].filter(Boolean).join(" ") || "wPay";
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1440;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const gradient = ctx.createLinearGradient(0, 0, 1024, 1440);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.58, "#f3f5f9");
  gradient.addColorStop(1, "#e3e8f1");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 1440);
  ctx.fillStyle = "#d4ddeb55";
  ctx.beginPath();
  ctx.moveTo(0, 1110);
  ctx.bezierCurveTo(350, 820, 730, 900, 1024, 1030);
  ctx.lineTo(1024, 1440);
  ctx.lineTo(0, 1440);
  ctx.fill();
  ctx.fillStyle = "#cbd6e244";
  ctx.beginPath();
  ctx.moveTo(0, 1350);
  ctx.bezierCurveTo(330, 1080, 700, 1040, 1024, 1130);
  ctx.lineTo(1024, 1440);
  ctx.lineTo(0, 1440);
  ctx.fill();
  ctx.strokeStyle = "#ffffffb3";
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 30, 964, 1380);
  if (logo) ctx.drawImage(logo, 90, 195, 370, 104);
  else {
    ctx.fillStyle = "#182135";
    ctx.font = "700 78px system-ui";
    ctx.fillText("wPay", 94, 280);
  }
  ctx.fillStyle = "#8290a5";
  ctx.font = "500 22px system-ui";
  ctx.fillText("ЛИЧНЫЙ ДОСТУП", 96, 345);
  ctx.save();
  ctx.beginPath();
  ctx.arc(512, 650, 240, 0, Math.PI * 2);
  ctx.clip();
  const avatar = ctx.createLinearGradient(272, 410, 752, 890);
  avatar.addColorStop(0, "#8ec4ff");
  avatar.addColorStop(1, "#2673d4");
  ctx.fillStyle = avatar;
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
  ctx.fillStyle = "#1b2538";
  ctx.font = "600 62px system-ui";
  ctx.fillText(name, 512, 1070, 830);
  ctx.fillStyle = "#7b899e";
  ctx.font = "400 30px system-ui";
  ctx.fillText(
    user?.username ? `@${user.username}` : "Ваш личный кошелёк",
    512,
    1130,
    830,
  );
  ctx.fillStyle = "#5597e5";
  ctx.fillRect(452, 1240, 120, 4);
  return canvas.toDataURL("image/png");
}

export default function WalletLockBadge() {
  const [face, setFace] = useState("");
  const user = getUser();
  useEffect(() => {
    let active = true;
    let photo: HTMLImageElement | null = null;
    let logo: HTMLImageElement | null = null;
    const paint = () => {
      if (active) setFace(badgeFace(photo, logo));
    };
    paint();
    const mark = new Image();
    mark.onload = () => {
      logo = mark;
      paint();
    };
    mark.src = "/brands/wpay-wordmark.svg";
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!active) return;
      photo = img;
      try {
        paint();
      } catch {
        photo = null;
        paint();
      }
    };
    if (user?.photo_url) img.src = user.photo_url;
    return () => {
      active = false;
      img.onload = null;
      mark.onload = null;
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
            cardColor="#f2f5fa"
            strapColor="#233047"
            metal="silver"
            finish="glossy"
            size={0.4}
            strapLength={0.1}
            breeze={0.18}
            damping={0.55}
            interactive
            intro="drop"
          />
        </Suspense>
      )}
    </div>
  );
}
