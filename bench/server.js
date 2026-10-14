// Minimal HTTP wrapper so k6 can hit htmlToPdf: POST raw HTML, get a PDF back.
// WORKERS=n forks n processes sharing the port (rendering is CPU-bound, one core per process).
import cluster from 'node:cluster';
import { createServer } from 'node:http';
import { htmlToPdf } from '../html2pdf.js';

const workers = Number(process.env.WORKERS) || 1;

if (workers > 1 && cluster.isPrimary) {
  for (let i = 0; i < workers; i++) cluster.fork();
} else {
  const images = { baseDir: new URL('../demo', import.meta.url).pathname };

  createServer(async (req, res) => {
    if (req.method !== 'POST') return res.writeHead(405).end();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try {
      const pdf = await htmlToPdf(Buffer.concat(chunks).toString(), { images });
      res.writeHead(200, { 'content-type': 'application/pdf' }).end(pdf);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  }).listen(process.env.PORT || 3000);
}
