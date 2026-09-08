#!/bin/bash
export HTTP_PROXY=http://127.0.0.1:5188
export HTTPS_PROXY=http://127.0.0.1:5188
export ALL_PROXY=socks5://127.0.0.1:5180
OUT="$(dirname "$0")/_ghdev.txt"
: > "$OUT"
R=$(curl -s -X POST https://github.com/login/device/code -H "Accept: application/json" -d "client_id=ClI8Qyz2nFzHdrF4&scope=repo read:org" 2>&1)
echo "RAW1=$R" >> "$OUT"
UC=$(echo "$R" | grep -o '"user_code":"[^"]*"' | cut -d'"' -f4)
DC=$(echo "$R" | grep -o '"device_code":"[^"]*"' | cut -d'"' -f4)
echo "USER_CODE=$UC" >> "$OUT"
echo "URL=https://github.com/login/device" >> "$OUT"
echo "WAITING_FOR_USER=1" >> "$OUT"
for i in $(seq 1 150); do
  sleep 5
  T=$(curl -s -X POST https://github.com/login/oauth/access_token -H "Accept: application/json" -d "client_id=ClI8Qyz2nFzHdrF4&device_code=$DC&grant_type=urn:ietf:params:oauth:grant-type:device_code" 2>&1)
  if echo "$T" | grep -q '"access_token"'; then
    AT=$(echo "$T" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
    echo "TOKEN_OBTAINED=1" >> "$OUT"
    echo "$AT" | gh auth login --hostname github.com --git-protocol https --with-token 2>&1 >> "$OUT"
    echo "LOGIN_RESULT=$?" >> "$OUT"
    exit 0
  fi
  if echo "$T" | grep -qi '"error"'; then
    echo "POLL_ERR=$T" >> "$OUT"
  fi
done
echo "TIMEOUT" >> "$OUT"