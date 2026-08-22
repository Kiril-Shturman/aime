#!/bin/bash
# Запуск доски. Переменная LOOP_TRIGGER_CMD — чем будить агента, когда
# человек поставил цель или задачу. Пусто — доска работает молча.
cd "$(dirname "$0")"
export LOOP_TRIGGER_CMD="${LOOP_TRIGGER_CMD:-ssh -i $HOME/.ssh/id_ed25519_oracle -o StrictHostKeyChecking=no ubuntu@143.47.186.106 /home/ubuntu/.npm-global/bin/openclaw cron run cba6e344-d88d-44c5-ab87-14bd35760089}"
exec python3 server.py
