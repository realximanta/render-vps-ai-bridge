/**
 * 🌐 render-vps-ai-bridge v2
 * Express + AI queue + GitHub routes + Telegram webhook.
 * By @tukuexe
 */
const express = require('express');
const queue = require('./queue');
const github = require('./github');
const { createBot } = require('./bot');

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
  stack: ['Node.js','Python','Kotlin','Rust','Telegram Bots','Cloudflare','Ollama','VPS']
};

function auth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key !== API_KEY) return res.status(401).json({ error: 'unauthorized', developer: DEVELOPER_INFO });
  next();
}

// ── Health ──
const health = (req, res) => res.json({
  status: 'alive',
  message: '🧠 AI Bridge v2 is running',
  version: '2.0.0',
  uptime_seconds: Math.floor((Date.now() - BOOT_TIME) / 1000),
  timestamp: new Date().toISOString(),
  stats: queue.stats(),
  github_configured: github.isConfigured(),
  developer: DEVELOPER_INFO
});
app.get('/', health);
app.get('/health', health);
app.head('/', (req, res) => res.status(200).end());
app.head('/health', (req, res) => res.status(200).end());

// ── AI Queue (⚠️ /pending BEFORE /:jobId!) ──
app.post('/api/ask', auth, (req, res) => {
  const { prompt, model, system, format } = req.body;
  if (!prompt || typeof prompt !== 'string')
    return res.status(400).json({ error: 'prompt is required' });
  const jobId = queue.submitJob({ prompt, model: model || 'chat', system, format });
  res.status(202).json({ ok: true, jobId, status: 'pending', developer: DEVELOPER_INFO });
});

app.get('/api/jobs/pending', auth, (req, res) => {
  const job = queue.nextPending();
  if (!job) return res.json({ job: null });
  res.json({ job });
});

app.get('/api/jobs/:jobId', auth, (req, res) => {
  const job = queue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json({ ...job, developer: DEVELOPER_INFO });
});

app.post('/api/jobs/:jobId/result', auth, (req, res) => {
  const ok = queue.completeJob(req.params.jobId, req.body.output, req.body.meta);
  if (!ok) return res.status(404).json({ error: 'job not found' });
  res.json({ ok: true, jobId: req.params.jobId });
});

// ── GitHub endpoints (external access) ──
app.get('/api/github/repos', auth, async (req, res) => {
  try { res.json({ ok: true, repos: await github.listRepos() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/github/repos/:name', auth, async (req, res) => {
  try {
    const info = await github.repoDetails(req.params.name);
    if (!info) return res.status(404).json({ error: 'repo not found' });
    res.json({ ok: true, repo: info });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Boot ──
async function main() {
  const publicUrl = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL;

  if (process.env.TELEGRAM_BOT_TOKEN && publicUrl) {
    try {
      const bot = createBot();
      const path = '/telegram/webhook';
      const webhookCb = await bot.createWebhook({ domain: publicUrl, path });
      app.use(webhookCb);
      console.log(`🤖 Telegram webhook set → ${publicUrl}${path}`);
    } catch (e) {
      console.error('⚠️ Telegram setup failed:', e.message);
    }
  } else {
    console.log('⚠️ Telegram bot inactive (missing token or PUBLIC URL)');
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║  🪄  render-vps-ai-bridge v2 — by @tukuexe   ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  🚀 Port:  ${String(PORT).padEnd(34)}║`);
    console.log(`║  🤖 Bot:   ${(process.env.TELEGRAM_BOT_TOKEN ? 'active' : 'inactive').padEnd(34)}║`);
    console.log(`║  🐙 GH:    ${(github.isConfigured() ? 'active' : 'inactive').padEnd(34)}║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
  });
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
