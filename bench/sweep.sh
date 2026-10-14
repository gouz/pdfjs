#!/bin/sh
# Capacity sweep: for each worker count, hold VUS concurrent users for 15s and print req/s + p95.
# Usage: sh bench/sweep.sh [workers...]   (default: 1 and every core)
cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-3456}
echo "workers,vus,req_s,p95_ms,fail_rate"
for w in ${@:-1 $(node -p 'os.availableParallelism()')}; do
  WORKERS=$w PORT=$PORT node bench/server.js 2>/dev/null & pid=$!
  sleep 2
  for v in 1 5 10 25 50 100 200; do
    k6 run -q --vus $v --duration 15s -e URL=http://localhost:$PORT \
      --summary-export /tmp/k6-sweep.json bench/k6.js >/dev/null 2>&1
    node -e '
      const m = require("/tmp/k6-sweep.json").metrics;
      console.log([process.argv[1], process.argv[2], m.http_reqs.rate.toFixed(0),
        m.http_req_duration["p(95)"].toFixed(0), m.http_req_failed.value].join(","))' $w $v
  done
  kill $pid; wait $pid 2>/dev/null
done
