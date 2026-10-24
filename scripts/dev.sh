#!/bin/bash
# 设备调试通道封装。
#
# 背景：这台机器上 USB adb 会在设备休眠时断开，网络 adb(5555) 可用但 adb daemon
# 会间歇性自行重启，导致「连上了却报 device not found」。所有设备操作都走这里，
# 每次执行前重新 connect，并对 daemon 掉线做重试。
#
# 用法：
#   bash scripts/dev.sh shell "ls /userdisk"
#   bash scripts/dev.sh pull /tmp/a.png "C:/path/a.png"
#   bash scripts/dev.sh push local.amr /userdisk/Favorite/
#   bash scripts/dev.sh start <appid> [page]
#
# 环境变量：PEN_SERIAL 可覆盖默认设备（USB 已连时可直接填 USB 序列号）。

set -u

SERIAL="${PEN_SERIAL:-192.168.1.68:5555}"
TRIES="${PEN_TRIES:-6}"

connect_once() {
  case "$SERIAL" in
    *:*) adb connect "$SERIAL" >/dev/null 2>&1 ;;
    *)   : ;;
  esac
}

# 重试执行：daemon 重启 / 连接掉线时整体重来
run() {
  local i
  for i in $(seq 1 "$TRIES"); do
    connect_once
    if adb -s "$SERIAL" get-state >/dev/null 2>&1; then
      if adb -s "$SERIAL" "$@"; then
        return 0
      fi
      # 命令本身失败：不再重试，把错误码透出去
      return $?
    fi
    sleep 2
  done
  echo "[dev] 无法连接到 $SERIAL（已重试 $TRIES 次）" >&2
  return 1
}

cmd="${1:-}"
[ -z "$cmd" ] && { echo "用法: dev.sh <shell|pull|push|start|...> [args]" >&2; exit 2; }
shift

case "$cmd" in
  shell)
    # 远端路径里的 / 不要被 Git Bash 改写
    MSYS_NO_PATHCONV=1 run shell "$@"
    ;;
  pull|push)
    MSYS_NO_PATHCONV=1 run "$cmd" "$@"
    ;;
  start)
    # miniapp_cli start <appid> [page]，页面名不带 --
    appid="$1"; page="${2:-}"
    run shell "miniapp_cli start $appid $page"
    ;;
  *)
    run "$cmd" "$@"
    ;;
esac
