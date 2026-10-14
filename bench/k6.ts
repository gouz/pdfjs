import http from 'k6/http';
import { check } from 'k6';

const docs = ['example', 'flex', 'images'].map((n) => ({ n, html: open(`../demo/${n}.html`) }));
const url = __ENV.URL || 'http://localhost:3000';

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      stages: [
        { duration: '10s', target: 10 },
        { duration: '30s', target: 10 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
    // one entry per doc so the summary shows per-document latency
    ...Object.fromEntries(docs.map((d) => [`http_req_duration{doc:${d.n}}`, ['p(95)<2000']])),
  },
};

export default function () {
  const d = docs[__ITER % docs.length];
  const r = http.post(url, d.html, { tags: { doc: d.n }, headers: { 'content-type': 'text/html' } });
  check(r, { 'pdf 200': (x) => x.status === 200 && String(x.body).startsWith('%PDF') });
}
