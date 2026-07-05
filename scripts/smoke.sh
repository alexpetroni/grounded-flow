#!/usr/bin/env bash
#
# End-to-end smoke test — the "workable product" gate (Global Definition of Done).
#
# Proves, against the running Docker stack with deterministic fake providers:
#   health  →  submit event & poll to completed  →  ingest sample corpus
#           →  POST /rag/query returns a grounded, cited answer
#           →  stream a chat completion (SSE)
#
# Usage:
#   bash scripts/smoke.sh                # brings the stack up, runs checks
#   SMOKE_NO_UP=1 bash scripts/smoke.sh  # assume the stack is already running
#   SMOKE_DOWN=1  bash scripts/smoke.sh  # tear the stack down at the end
#
# Exits 0 on success, non-zero on the first failed check.
set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:8080}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.smoke.yml")

log()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# Evaluate a python expression against the JSON on stdin, bound as `d` (no jq dependency).
jget() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }

cleanup() {
  if [[ "${SMOKE_DOWN:-0}" == "1" ]]; then
    log "Tearing down stack"
    "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ "${SMOKE_NO_UP:-0}" != "1" ]]; then
  log "Starting from a clean slate"
  "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
  log "Building & starting the stack (fake providers)"
  "${COMPOSE[@]}" up -d --build
fi

# 1. Health ------------------------------------------------------------------
log "Waiting for /health"
for i in $(seq 1 60); do
  if code=$(curl -s -o /tmp/smoke_health.json -w '%{http_code}' "$API_URL/health" 2>/dev/null) && [[ "$code" == "200" ]]; then
    status=$(jget "d['status']" < /tmp/smoke_health.json)
    ok "health: $status"
    break
  fi
  [[ $i -eq 60 ]] && fail "API did not become healthy in time"
  sleep 2
done

# 2. Event submit + poll to completed ---------------------------------------
log "Submitting an event (echo workflow)"
event_id=$(curl -s -X POST "$API_URL/events" \
  -H 'content-type: application/json' \
  -d '{"workflowType":"echo","data":{"message":"smoke"}}' | jget "d['eventId']")
[[ -n "$event_id" ]] || fail "no eventId returned"
ok "event submitted: $event_id"

for i in $(seq 1 30); do
  status=$(curl -s "$API_URL/events/$event_id" | jget "d['status']")
  if [[ "$status" == "completed" ]]; then ok "event completed"; break; fi
  [[ "$status" == "failed" ]] && fail "event failed"
  [[ $i -eq 30 ]] && fail "event did not complete (last: $status)"
  sleep 1
done

# 3. Ingest sample document --------------------------------------------------
log "Ingesting a document"
content_b64=$(printf 'Retrieval-Augmented Generation combines retrieval and generation to ground answers in source documents. Vector databases store dense and sparse embeddings for hybrid search.' | base64 | tr -d '\n')
doc_id=$(curl -s -X POST "$API_URL/documents" \
  -H 'content-type: application/json' \
  -d "{\"source\":\"smoke.txt\",\"mimeType\":\"text/plain\",\"content\":\"$content_b64\"}" | jget "d['id']")
[[ -n "$doc_id" ]] || fail "no document id returned"
ok "document submitted: $doc_id"

for i in $(seq 1 30); do
  status=$(curl -s "$API_URL/documents/$doc_id" | jget "d['status']")
  if [[ "$status" == "completed" ]]; then ok "document ingested"; break; fi
  [[ "$status" == "failed" ]] && fail "ingestion failed"
  [[ $i -eq 30 ]] && fail "ingestion did not complete (last: $status)"
  sleep 1
done

# 4. RAG query — grounded, cited answer -------------------------------------
log "Querying RAG"
curl -s -X POST "$API_URL/rag/query" \
  -H 'content-type: application/json' \
  -d '{"query":"What does retrieval augmented generation do?"}' > /tmp/smoke_rag.json
answer=$(jget "d['answer']" < /tmp/smoke_rag.json)
n_cites=$(jget "len(d['citations'])" < /tmp/smoke_rag.json)
grounded=$(jget "d['grounded']" < /tmp/smoke_rag.json)
[[ -n "$answer" ]] || fail "empty RAG answer"
[[ "$n_cites" -ge 1 ]] || fail "RAG answer had no citations"
[[ "$grounded" == "True" ]] || fail "RAG answer not grounded"
ok "RAG answer grounded with $n_cites citation(s)"

# 5. Chat completion, JSON body (OpenAI default: no stream field) -----------
log "Requesting a non-streaming chat completion"
completion=$(curl -s -X POST "$API_URL/v1/chat/completions" \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"hello"}]}')
echo "$completion" | grep -q '"object":"chat.completion"' || fail "no JSON chat.completion body"
ok "omitted stream produced a single JSON completion"

# 6. Streaming chat completion ----------------------------------------------
log "Streaming a chat completion"
stream=$(curl -s -N -X POST "$API_URL/v1/chat/completions" \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"hello"}],"stream":true}')
echo "$stream" | grep -q 'data: ' || fail "no SSE data frames"
echo "$stream" | grep -q '\[DONE\]' || fail "stream did not terminate with [DONE]"
ok "chat stream produced SSE frames terminated by [DONE]"

log "SMOKE PASSED"
