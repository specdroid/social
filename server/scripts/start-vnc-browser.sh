#!/bin/bash
# Start headed Chromium in xvfb with VNC + cloudflared tunnel for Facebook CAPTCHA solving
set -e

# ── Config ──
DISPLAY_NUM=${1:-99}
CDP_PORT=${2:-9336}
VNC_PORT=${3:-5900}
NOVNC_PORT=${4:-8080}
RESOLUTION=${5:-480x900}
CHROME_PROFILE=${6:-/tmp/chrome-vnc-profile}

echo "=== Starting VNC Browser Stack ==="
echo "Display: :$DISPLAY_NUM"
echo "CDP port: $CDP_PORT"
echo "VNC port: $VNC_PORT"
echo "noVNC port: $NOVNC_PORT"
echo "Resolution: $RESOLUTION"
echo "Profile: $CHROME_PROFILE"

# Kill any existing instances
pkill -f "Xvfb :$DISPLAY_NUM" 2>/dev/null || true
pkill -f "x11vnc.*:$DISPLAY_NUM" 2>/dev/null || true
pkill -f "novnc_proxy.*$NOVNC_PORT" 2>/dev/null || true
pkill -f "cloudflared tunnel.*$NOVNC_PORT" 2>/dev/null || true
sleep 1

# ── 1. Virtual framebuffer ──
Xvfb ":$DISPLAY_NUM" -screen 0 "${RESOLUTION}x24" &
sleep 1

# ── 2. Chromium (headed, CDP enabled) ──
DISPLAY=":$DISPLAY_NUM" snap run chromium --no-sandbox \
  --window-size="$RESOLUTION" \
  --remote-debugging-port="$CDP_PORT" \
  --user-data-dir="$CHROME_PROFILE" \
  --disable-blink-features=AutomationControlled \
  --user-agent="Mozilla/5.0 (Linux; Android 14; SM-A156B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36" &
sleep 3

# ── 3. VNC ──
x11vnc -display ":$DISPLAY_NUM" -forever -shared -rfbport "$VNC_PORT" -quiet &
sleep 1

# ── 4. noVNC (web-based VNC client) ──
if [ ! -d /tmp/novnc ]; then
  git clone --depth=1 https://github.com/novnc/noVNC.git /tmp/novnc
fi
/tmp/novnc/utils/novnc_proxy --vnc "localhost:$VNC_PORT" --listen "$NOVNC_PORT" &
sleep 2

# ── 5. Cloudflare tunnel ──
cloudflared tunnel --url "http://localhost:$NOVNC_PORT" --logfile /tmp/cloudflared.log &

echo "=== Stack started ==="
echo "CDP: http://localhost:$CDP_PORT"
echo "VNC: localhost:$VNC_PORT"
echo "noVNC: http://localhost:$NOVNC_PORT"
echo ""
echo "Get the tunnel URL:"
echo "  grep -o 'https://[^ ]*\.try\.cloudflare\.com' /tmp/cloudflared.log | tail -1"
echo ""
echo "Set FB_TUNNEL_URL in .env to that URL"
echo ""
echo "To stop: pkill -f 'Xvfb :$DISPLAY_NUM'"
