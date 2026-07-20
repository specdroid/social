#!/bin/bash
API="https://omniroutelb.duckdns.org/v1/chat/completions"
KEY="sk-b653e4891f59f733-ba43d9-5d499c2d"

models=(
  "auto/coding:free"
  "auto"
  "auto/coding"
  "auto/research"
  "free"
  "auto:free"
  "zenmux/mistralai/mistral-large-2512"
  "zm/mistralai/mistral-large-2512"
  "pollinations/gpt-4o-mini"
  "pollinations/claude-3.5-sonnet"
  "nvidia/llama-3.1-nemotron-ultra-253b-v1"
  "nousresearch/deephermes-3-llama-3-8b-preview:free"
  "qwen/qwen3-235b-a22b:free"
  "mistralai/mistral-small-3.1-24b-instruct:free"
  "tngtech/deepseek-r1t-chimera:free"
  "rekaai/reka-flash-3:free"
  "stepfun/step-3-flash:free"
  "moonshotai/kimi-vl-a3b-thinking:free"
  "thudm/glm-4-9b:free"
  "microsoft/mai-ds-r1:free"
  "opengvlab/internvl3-78b:free"
)

for m in "${models[@]}"; do
  echo -n "Testing $m ... "
  result=$(curl -s "$API" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $KEY" \
    -d "{\"model\":\"$m\",\"messages\":[{\"role\":\"user\",\"content\":\"say ok\"}],\"max_tokens\":5}" 2>&1)
  if echo "$result" | grep -q '"error"'; then
    echo "FAIL: $(echo "$result" | grep -o '"message":"[^"]*"' | head -1)"
  else
    echo "OK"
  fi
done
