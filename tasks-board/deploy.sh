#!/bin/bash
# Разворачивает доску и цикл на чистом сервере Ubuntu.
#
#   ./deploy.sh <ip>          — поставить всё с нуля
#
# Что делает: ставит OpenClaw и Caddy, поднимает доску службой, выпускает
# сертификат на имя вида board.<ip-через-дефисы>.nip.io, переносит данные и
# ключи со старого сервера, регистрирует коннектор и цикл.
#
# Идемпотентно: повторный запуск ничего не ломает, просто обновляет.
set -euo pipefail

IP="${1:?укажи адрес нового сервера}"
OLD="${OLD_HOST:-143.47.186.106}"          # откуда переносим
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_oracle}"
HOST="board.${IP//./-}.nip.io"
SSH="ssh -i $KEY -o StrictHostKeyChecking=no"
REMOTE="root@$IP"                           # у Contabo первый вход под root

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

say "Проверяю связь с $IP"
$SSH "$REMOTE" 'echo ок; lsb_release -ds; nproc; free -g | sed -n 2p'

say "Готовлю пользователя и систему"
$SSH "$REMOTE" 'id ubuntu >/dev/null 2>&1 || adduser --disabled-password --gecos "" ubuntu
mkdir -p /home/ubuntu/.ssh && cp /root/.ssh/authorized_keys /home/ubuntu/.ssh/ 2>/dev/null || true
chown -R ubuntu:ubuntu /home/ubuntu/.ssh && chmod 700 /home/ubuntu/.ssh
usermod -aG sudo ubuntu && echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu
loginctl enable-linger ubuntu
apt-get update -qq && apt-get install -y -qq python3-aiohttp git curl debian-keyring debian-archive-keyring apt-transport-https'

say "Ставлю Caddy"
$SSH "$REMOTE" 'curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy.gpg
echo "deb [signed-by=/usr/share/keyrings/caddy.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" > /etc/apt/sources.list.d/caddy.list
apt-get update -qq && apt-get install -y -qq caddy'

say "Ставлю OpenClaw"
$SSH "$REMOTE" 'su - ubuntu -c "export OPENCLAW_NO_PROMPT=1 OPENCLAW_NO_ONBOARD=1; curl -fsSL https://openclaw.ai/install.sh | bash"'

say "Переношу состояние со старого сервера"
for what in ".openclaw" "projects" ".ssh/id_ed25519_tasks" "loop.md" "board-mcp.py"; do
  echo "  $what"
  $SSH -A "ubuntu@$OLD" "tar czf - -C /home/ubuntu $what 2>/dev/null" \
    | $SSH "$REMOTE" "su - ubuntu -c 'tar xzf - -C /home/ubuntu'" || echo "  (пропущено)"
done

say "Поднимаю доску службой"
$SSH "$REMOTE" "su - ubuntu -c 'mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/board.service <<EOF
[Unit]
Description=Доска задач
After=network.target

[Service]
WorkingDirectory=/home/ubuntu/projects/aime/tasks-board
Environment=PORT=8095
Environment=LOOP_JOB_ID=\${LOOP_JOB_ID:-}
Environment=LOOP_TRIGGER_CMD=/home/ubuntu/.npm-global/bin/openclaw cron run \${LOOP_JOB_ID:-}
ExecStart=/usr/bin/python3 /home/ubuntu/projects/aime/tasks-board/server.py
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload && systemctl --user enable --now board'"

say "Выпускаю сертификат на $HOST"
$SSH "$REMOTE" "printf '%s\n' '$HOST {' '    encode zstd gzip' '    reverse_proxy 127.0.0.1:8095' '}' > /etc/caddy/Caddyfile
systemctl restart caddy"

sleep 15
say "Проверяю"
curl -s -o /dev/null -w "доска снаружи: %%{http_code}\n" --max-time 25 "https://$HOST/" || true
$SSH "$REMOTE" "su - ubuntu -c '~/.npm-global/bin/openclaw mcp probe'" || true

cat <<NOTE

Готово. Осталось руками:
  1. Переключить кнопку мини-аппы бота на https://$HOST/
     curl -X POST "https://api.telegram.org/bot<TOKEN>/setChatMenuButton" \\
       -d '{"menu_button":{"type":"web_app","text":"Доска","web_app":{"url":"https://$HOST/"}}}'
  2. Убедиться, что цикл жив: openclaw cron status
  3. Погасить старый сервер, когда всё проверено.
NOTE
