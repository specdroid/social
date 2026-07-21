#!/bin/bash
TOKEN=$(curl -s "https://edulb.duckdns.org/api/auth/login" -H "Content-Type: application/json" -d '{"email":"ahmad.zeineddine@hotmail.com","password":"Ahmad@2025"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "Token: ${TOKEN:0:20}..."
echo "Testing status..."
curl -s "https://edulb.duckdns.org/api/omniroute/status" -H "Authorization: Bearer $TOKEN"
echo ""
echo "Testing chat..."
curl -s "https://edulb.duckdns.org/api/omniroute/chat" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"say OK"}]}' --max-time 30
echo ""
