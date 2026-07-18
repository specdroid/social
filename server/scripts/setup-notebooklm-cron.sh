#!/bin/bash
# Setup NotebookLM auto-refresh cron job
# Run this on the VPS

set -e

echo "Setting up NotebookLM auto-refresh cron job..."

# Find the notebooklm binary
NLM_BIN=$(which notebooklm 2>/dev/null || echo "/usr/local/bin/notebooklm")

if [ ! -f "$NLM_BIN" ]; then
  echo "Error: notebooklm not found at $NLM_BIN"
  echo "Install with: sudo pip install --break-system-packages 'notebooklm-py[browser]'"
  exit 1
fi

# Create refresh script
SCRIPT_DIR="/opt/social/server/scripts"
mkdir -p "$SCRIPT_DIR"

cat > "$SCRIPT_DIR/notebooklm-refresh.sh" << 'EOF'
#!/bin/bash
export PATH="/usr/local/bin:$PATH"
/usr/local/bin/notebooklm auth refresh >> /var/log/notebooklm-refresh.log 2>&1
EOF

chmod +x "$SCRIPT_DIR/notebooklm-refresh.sh"

# Add cron job (daily at 3 AM)
CRON_LINE="0 3 * * * $SCRIPT_DIR/notebooklm-refresh.sh"
(crontab -l 2>/dev/null | grep -v "notebooklm-refresh"; echo "$CRON_LINE") | crontab -

echo "Done! Cron job added:"
echo "  $CRON_LINE"
echo ""
echo "Logs: /var/log/notebooklm-refresh.log"
echo ""
echo "Test manually: $SCRIPT_DIR/notebooklm-refresh.sh"
