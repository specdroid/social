#!/bin/bash
env HOME=/home/ubuntu PATH="/usr/local/bin:/usr/bin:/bin" /usr/local/bin/notebooklm auth refresh >> /var/log/notebooklm-refresh.log 2>&1
