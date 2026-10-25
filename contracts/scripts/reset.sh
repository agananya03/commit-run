#!/usr/bin/env bash
# Fresh demo chain in under 90 seconds:
#   1. kill whatever listens on :8545 (Hardhat node) and :8546 (Anvil fork) and start both again
#   2. deploy:seed (contracts, wallets, transfers -> deployments/localhost.json)
#   3. MIP-12: the full flow, ends Executed
#   4. MIP-17: proposed and voted, left Active
#   5. MIP-21: left un-proposed for the live demo
#   6. re-forks the sim (POST /reset) if it is running, prints every address and the live MIP-21 commands
#
#   bash contracts/scripts/reset.sh          (Git Bash on Windows, or any bash on macOS/Linux; needs Foundry's anvil)
#
# Env: RPC_PORT (8545), ANVIL_PORT (8546), SIM_URL (http://localhost:4002), TIMELOCK_DELAY (60), CHAIN_START_DATE.
# The node and Anvil keep running after the script exits; their logs go to $LOG_DIR (default: a temp dir).
set -euo pipefail

CONTRACTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CONTRACTS"
RPC_PORT="${RPC_PORT:-8545}"
ANVIL_PORT="${ANVIL_PORT:-8546}"
RPC_URL="http://127.0.0.1:$RPC_PORT"
ANVIL_URL="http://127.0.0.1:$ANVIL_PORT"
SIM_URL="${SIM_URL:-http://localhost:4002}"
LOG_DIR="${LOG_DIR:-${TMPDIR:-/tmp}/poi-reset}"
BUDGET=90
mkdir -p "$LOG_DIR"
export RPC_URL TS_NODE_TRANSPILE_ONLY=true # ts-node without type-checking: ~5 s faster per governance call

START=$(date +%s)
LAP=$START
step() {
  local now
  now=$(date +%s)
  printf '\n[%3ss] %s\n' "$((now - START))" "$*"
  LAP=$now
}
die() {
  echo "reset.sh: $*" >&2
  exit 1
}

# PIDs listening on a TCP port: lsof on macOS/Linux, netstat on Windows (Git Bash).
pids_on_port() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null | sort -u || true
  else
    netstat -ano 2>/dev/null | awk -v p=":$1" '$1 == "TCP" && $4 == "LISTENING" && substr($2, length($2) - length(p) + 1) == p { print $5 }' | sort -u
  fi
}

kill_port() {
  local pid
  for pid in $(pids_on_port "$1"); do
    if command -v taskkill >/dev/null 2>&1; then taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true; else kill "$pid" 2>/dev/null || true; fi
  done
  for _ in $(seq 1 40); do
    [ -z "$(pids_on_port "$1")" ] && return 0
    sleep 0.25
  done
  die "port $1 is still in use"
}

rpc() {
  curl -s -m 3 -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$2\",\"params\":${3:-[]}}" "$1"
}

wait_rpc() {
  for _ in $(seq 1 120); do
    rpc "$1" eth_blockNumber | grep -q '"result"' && return 0
    sleep 0.25
  done
  die "$2 did not come up on $1; see $3"
}

gov() {
  ./node_modules/.bin/ts-node scripts/governance.ts "$@"
}

command -v anvil >/dev/null 2>&1 || die "anvil not found; install Foundry (https://getfoundry.sh)"
[ -x node_modules/.bin/hardhat ] || die "run npm install in contracts/ first"

step "stopping the Hardhat node (:$RPC_PORT) and the Anvil fork (:$ANVIL_PORT)"
kill_port "$ANVIL_PORT"
kill_port "$RPC_PORT"

# The node and deploy:seed each take ~15 s just to load Hardhat, so they start together (deploy-seed waits for
# the node). Anvil forks as soon as the node answers; the sim re-forks at the head at the end, and every
# simulation re-forks anyway.
step "starting the Hardhat node and deploy:seed (logs: $LOG_DIR/hardhat.log, deploy-seed.log)"
nohup ./node_modules/.bin/hardhat node --port "$RPC_PORT" >"$LOG_DIR/hardhat.log" 2>&1 &
disown
./node_modules/.bin/hardhat run scripts/deploy-seed.ts --network localhost >"$LOG_DIR/deploy-seed.log" 2>&1 &
SEED_PID=$!
wait_rpc "$RPC_URL" "Hardhat node" "$LOG_DIR/hardhat.log"

step "node up; starting the Anvil fork (log: $LOG_DIR/anvil.log)"
nohup anvil --fork-url "$RPC_URL" --port "$ANVIL_PORT" --steps-tracing >"$LOG_DIR/anvil.log" 2>&1 &
disown

wait "$SEED_PID" || die "deploy:seed failed; see $LOG_DIR/deploy-seed.log"
step "deploy:seed done: $(grep -E '^wallets ' "$LOG_DIR/deploy-seed.log")"
wait_rpc "$ANVIL_URL" "Anvil" "$LOG_DIR/anvil.log"

# One ts-node process for every step (start-up costs ~5 s each).
step "MIP-12 full flow (Executed), MIP-17 propose + vote (Active), MIP-21 untouched"
gov flow MIP-12 + open MIP-17 + status MIP-21 + addresses | tee "$LOG_DIR/governance.log" | grep -Ev '^\s*$|^  "|^\{|^\}|^  \]|^    "'
grep -q '^done\.' "$LOG_DIR/governance.log" || die "MIP-12 did not reach Executed; see $LOG_DIR/governance.log"
grep -q '^MIP-17: Active ' "$LOG_DIR/governance.log" || die "MIP-17 should be Active; see $LOG_DIR/governance.log"
grep -q '^MIP-21: not proposed ' "$LOG_DIR/governance.log" || die "MIP-21 should not be proposed; see $LOG_DIR/governance.log"
echo "  block $(($(rpc "$RPC_URL" eth_blockNumber | sed -E 's/.*"result":"([^"]+)".*/\1/')))  rpc $RPC_URL  anvil $ANVIL_URL"

if curl -s -m 10 -o /dev/null "$SIM_URL/health"; then
  step "re-forking the sim at the new head: $(curl -s -m 15 -X POST -H 'content-type: application/json' -d '{}' "$SIM_URL/reset")"
else
  step "sim not running on $SIM_URL (start it: cd sim; npm start)"
fi

TOTAL=$(($(date +%s) - START))
cat <<EOF

[${TOTAL}s] ready. MIP-12 Executed, MIP-17 Active, MIP-21 not proposed.

Live MIP-21 run (backend on :4000 and sim on :4002 running, USE_MOCKS=false for real simulations):
  cd backend; npm run demo:halt

Or step by step from contracts/ (PowerShell uses ';', not '&&'):
  npm run gov -- propose MIP-21; npm run gov -- advance 2 0; npm run gov -- vote MIP-21; npm run gov -- advance; npm run gov -- queue MIP-21
  npm run gov -- execute MIP-21     # after the watchdog flags: reverts GuardFlagged
  npm run gov -- override MIP-21    # token holders clear the flag by vote, then MIP-21 executes
EOF
[ "$TOTAL" -le "$BUDGET" ] || echo "WARNING: took ${TOTAL}s, over the ${BUDGET}s budget" >&2
