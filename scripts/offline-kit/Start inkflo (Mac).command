#!/bin/bash
# Runs inkflo from this folder with no internet.
cd "$(dirname "$0")"
PORT=5191
echo "inkflo is running at http://localhost:$PORT/  (keep this window open; close it when you are done)"
( sleep 1; open "http://localhost:$PORT/" ) &
if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server $PORT --bind 127.0.0.1
elif command -v ruby >/dev/null 2>&1; then exec ruby -run -e httpd . -p $PORT -b 127.0.0.1
else echo "This Mac has no Python or Ruby. Ask your instructor for the installable version."; read -r; fi
