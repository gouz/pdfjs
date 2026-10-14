#!/bin/sh
# Capacity sweep: for each worker count, hold VUS concurrent users for 15s and print req/s, p95
# and peak memory (RSS of the server and its cluster workers, sampled every 0.5s).
# Usage: [RUNTIME=bun] sh bench/sweep.sh [workers...]   (default: node, 1 and every core)
cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-3456}
RUNTIME=${RUNTIME:-node}
export NODE_ENV=production  # React dev build: slower and heavier
rss_mb() { ps -A -o rss=,ppid=,pid= | awk -v p=$pid '$2 == p || $3 == p { s += $1 } END { printf "%d", s / 1024 }'; }
echo "runtime,workers,vus,req_s,p95_ms,fail_rate,peak_rss_mb"
for w in ${@:-1 $(node -p 'os.availableParallelism()')}; do
  WORKERS=$w PORT=$PORT $RUNTIME bench/server.ts 2>/dev/null & pid=$!
  sleep 2
  for v in 1 5 10 25 50 100 200; do
    k6 run -q --vus $v --duration 15s -e URL=http://localhost:$PORT \
      --summary-export /tmp/k6-sweep.json bench/k6.ts >/dev/null 2>&1 & k6pid=$!
    peak=0
    while kill -0 $k6pid 2>/dev/null; do
      m=$(rss_mb); [ "$m" -gt "$peak" ] && peak=$m
      sleep 0.5
    done
    node -e '
      const m = require("/tmp/k6-sweep.json").metrics;
      console.log([process.argv[4], process.argv[1], process.argv[2], m.http_reqs.rate.toFixed(0),
        m.http_req_duration["p(95)"].toFixed(0), m.http_req_failed.value, process.argv[3]].join(","))' $w $v $peak $RUNTIME
  done
  kill $pid; wait $pid 2>/dev/null
done
