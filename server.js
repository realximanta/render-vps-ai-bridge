/**
 * 🪄 render-vps-ai-bridge
 * Bridge between users and VPS-hosted Ollama.
 * No secrets in code — everything via env vars.
 * Developer: Himanta Bhuyan (@tukuexe)
 */

const express = require('express');
const app = express();
app.use(express.json({ limit: '5mb' }));

const BOOT_TIME = Date.now();
const API_KEY = process.env.API_KEY || 'CHANGE_ME_123';

const DEVELOPER_INFO = {
  name: 'Tuku',
  real_name: 'Himanta Bhuyan',
  github_profiles: {
    tukuexe: 'https://github.com/tukuexe',
    realximanta: 'https://github.com/realximanta',
    realtuku: 'https://github.com/realtuku'
  },
  bio: 'Self-taught developer & builder. Telegram bots, Android apps, APIs & automation.',
  philosophy: "Don't fear errors. Understand the problem. Don't stop at limitations.",
  stack: ['Node.js', 'Python', 'Kotlin', 'Rust', 'Telegram Bots', 'Cloudflare', 'Ollama', 'VPS']
};

// ─── In-memory stores ───
const jobs = new Map();
const queue = [];

// ─── Auth ───
function auth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'unauthorized', developer: DEVELOPER_INFO });
  }
  next();
}

// ─── Health (kept alive by UptimeRobot) ───
const health = (req, res) => {
  res.status(200).json({
    status: 'alive',
    message: '🧠 AI Bridge is running',
    version: '1.0.0',
    uptime_seconds: Math.floor((Date.now() - BOOT_TIME) / 1000),
    timestamp: new Date().toISOString(),
    stats: { total_jobs: jobs.size, pending_jobs: queue.length },
    developer: DEVELOPER_INFO
  });
};
app.get('/', health);
app.get('/health', health);
app.head('/', (req, res) => res.status(200).end());
app.head('/health', (req, res) => res.status(200).end());

// ─── 1. Submit prompt ───
app.post('/api/ask', auth, (req, res) => {
  const { prompt, model } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt is required', developer: DEVELOPER_INFO });
  }

  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  jobs.set(jobId, {
    jobId, prompt,
    model: model || 'chat',
    status: 'pending',
    result: null, meta: null,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null
  });
  queue.push(jobId);

  res.status(202).json({
    ok: true, jobId, status: 'pending',
    message: '📥 Job queued. Poll /api/jobs/:jobId',
    developer: DEVELOPER_INFO
  });
});

// ─── 2. Poll result ───
app.get('/api/jobs/:jobId', auth, (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found', developer: DEVELOPER_INFO });
  res.json({ ...job, developer: DEVELOPER_INFO });
});

// ─── 3. Worker asks for next job ───
app.get('/api/jobs/pending', auth, (req, res) => {
  let jobId;
  while (queue.length > 0) {
    jobId = queue.shift();
    if (jobs.has(jobId)) break;
    jobId = null;
  }
  if (!jobId) return res.json({ job: null });

  const job = jobs.get(jobId);
  job.status = 'processing';
  job.startedAt = Date.now();

  res.json({
    job: { jobId: job.jobId, prompt: job.prompt, model: job.model }
  });
});

// ─── 4. Worker posts result ───
app.post('/api/jobs/:jobId/result', auth, (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });

  job.status = 'done';
  job.result = req.body.output ?? null;
  job.meta = req.body.meta ?? null;
  job.completedAt = Date.now();
  job.duration_ms = job.completedAt - (job.startedAt || job.createdAt);

  res.json({ ok: true, jobId: job.jobId, developer: DEVELOPER_INFO });
});

// ─── Cleanup ───
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  let n = 0;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < cutoff && job.status === 'done') { jobs.delete(id); n++; }
  }
  if (n) console.log(`🧹 Cleaned ${n} old jobs`);
}, 10 * 60 * 1000);

// ─── Boot ───
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║  🪄  render-vps-ai-bridge — by @tukuexe       ║');
  console.log('╠═══════════════════════════════════════════════╣');
  console.log(`║  🚀 Listening on port ${String(PORT).padEnd(22)}║`);
  console.log('║  💓 Health:  /  /health  HEAD /               ║');
  console.log('║  📥 Submit:  POST /api/ask                    ║');
  console.log('║  📊 Poll:    GET  /api/jobs/:jobId            ║');
  console.log('║  🤖 Worker:  GET  /api/jobs/pending           ║');
  console.log('║  ✅ Result:  POST /api/jobs/:jobId/result     ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log('');
});
