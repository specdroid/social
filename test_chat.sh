#!/bin/bash
TOKEN=$(curl -s "https://edulb.duckdns.org/api/auth/login" -H "Content-Type: application/json" -d '{"email":"ahmad.zeineddine@hotmail.com","password":"Ahmad@2025"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "Testing chat..."
time curl -s --max-time 120 "https://edulb.duckdns.org/api/omniroute/chat" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"say OK"}]}'
echo ""
echo "Exit code: $?"
