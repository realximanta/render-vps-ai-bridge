/**
 * 🗄️ In-memory AI job queue
 * VPS worker polls /api/jobs/pending
 */

const jobs = new Map();
const queue = [];

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function submitJob({ prompt, model = 'chat', system = null, format = null }) {
  const jobId = makeId();
  jobs.set(jobId, {
    jobId, prompt, model, system, format,
    status: 'pending', result: null, meta: null,
    createdAt: Date.now(), startedAt: null, completedAt: null
  });
  queue.push(jobId);
  return jobId;
}

function getJob(jobId) { return jobs.get(jobId); }

function nextPending() {
  let jobId;
  while (queue.length > 0) {
    jobId = queue.shift();
    if (jobs.has(jobId)) break;
    jobId = null;
  }
  if (!jobId) return null;
  const job = jobs.get(jobId);
  job.status = 'processing';
  job.startedAt = Date.now();
  return {
    jobId: job.jobId,
    prompt: job.prompt,
    model: job.model,
    system: job.system,
    format: job.format
  };
}

function completeJob(jobId, output, meta) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.status = 'done';
  job.result = output ?? null;
  job.meta = meta ?? null;
  job.completedAt = Date.now();
  job.duration_ms = job.completedAt - (job.startedAt || job.createdAt);
  return true;
}

async function pollJob(jobId, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = jobs.get(jobId);
    if (!job) return null;
    if (job.status === 'done') return job;
    if (job.status === 'failed') return null;
    await new Promise(r => setTimeout(r, 1500));
  }
  return null;
}

async function aiSync(prompt, model = 'chat', timeoutMs = 300000) {
  const id = submitJob({ prompt, model });
  const result = await pollJob(id, timeoutMs);
  return result?.result || null;
}

function extractJson(text) {
  if (!text) return null;
  const stripped = String(text).replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(stripped.slice(start, end + 1)); }
  catch { return null; }
}

async function aiJson(prompt, model = 'code', timeoutMs = 180000) {
  const id = submitJob({ prompt, model, format: 'json' });
  const result = await pollJob(id, timeoutMs);
  if (!result) return null;
  return extractJson(result.result);
}

function stats() {
  return { total_jobs: jobs.size, pending_jobs: queue.length };
}

// Cleanup old completed jobs
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  let n = 0;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < cutoff && job.status === 'done') { jobs.delete(id); n++; }
  }
  if (n) console.log(`🧹 Cleaned ${n} old jobs`);
}, 10 * 60 * 1000);

module.exports = {
  submitJob, getJob, nextPending, completeJob,
  pollJob, aiSync, aiJson, extractJson, stats
};
