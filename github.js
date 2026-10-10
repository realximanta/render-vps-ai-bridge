/**
 * 🐙 GitHub helpers — Octokit + in-memory cache
 */
const { Octokit } = require('@octokit/rest');

const GH_TOKEN = process.env.GH_TOKEN;
const octokit = GH_TOKEN ? new Octokit({ auth: GH_TOKEN }) : null;

let repoCache = null;
let repoCacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

let _me = null;
async function me() {
  if (_me) return _me;
  const { data } = await octokit.users.getAuthenticated();
  _me = data.login;
  return _me;
}

function isConfigured() { return !!octokit; }

async function listRepos(useCache = true) {
  if (!octokit) throw new Error('GitHub not configured (GH_TOKEN missing)');
  const now = Date.now();
  if (useCache && repoCache && (now - repoCacheTs) < CACHE_TTL) return repoCache;

  const { data: repos } = await octokit.repos.listForAuthenticatedUser({
    sort: 'updated', per_page: 50
  });

  // Parallel enrichment
  const enriched = await Promise.all(repos.map(async r => {
    let lastCommit = '—', lastCommitBy = '—';
    try {
      const { data: commits } = await octokit.repos.listCommits({
        owner: r.owner.login, repo: r.name, per_page: 1
      });
      if (commits[0]) {
        lastCommit = commits[0].commit.message.split('\n')[0].slice(0, 60);
        lastCommitBy = commits[0].commit.author?.name || '—';
      }
    } catch {}
    return {
      name: r.name,
      full_name: r.full_name,
      private: r.private,
      language: r.language || '—',
      updated: r.updated_at,
      default_branch: r.default_branch || 'main',
      description: r.description || '—',
      url: r.html_url,
      stars: r.stargazers_count,
      forks: r.forks_count,
      last_commit: lastCommit,
      last_commit_by: lastCommitBy
    };
  }));

  enriched.sort((a, b) => new Date(b.updated) - new Date(a.updated));
  repoCache = enriched;
  repoCacheTs = now;
  return enriched;
}

async function repoDetails(name) {
  if (!octokit) throw new Error('GitHub not configured');
  try {
    const user = await me();
    const { data: r } = await octokit.repos.get({ owner: user, repo: name });
    return {
      name: r.name, full_name: r.full_name, private: r.private,
      url: r.html_url, default_branch: r.default_branch || 'main',
      description: r.description || '—', language: r.language || '—',
      stars: r.stargazers_count, forks: r.forks_count
    };
  } catch { return null; }
}

async function listFiles(repoName, path = '') {
  if (!octokit) throw new Error('GitHub not configured');
  try {
    const user = await me();
    const { data } = await octokit.repos.getContent({ owner: user, repo: repoName, path });
    const arr = Array.isArray(data) ? data : [data];
    return arr.map(c => ({ name: c.name, path: c.path, type: c.type, size: c.size || 0 }));
  } catch { return []; }
}

async function readFile(repoName, path) {
  if (!octokit) throw new Error('GitHub not configured');
  try {
    const user = await me();
    const { data } = await octokit.repos.getContent({ owner: user, repo: repoName, path });
    if (data.content) return Buffer.from(data.content, 'base64').toString('utf-8');
    return null;
  } catch { return null; }
}

async function writeFile(repoName, path, content, message, branch = null) {
  if (!octokit) throw new Error('GitHub not configured');
  try {
    const user = await me();

    // 🎯 FIX: If no branch given, fetch repo's default branch
    if (!branch) {
      const { data: repo } = await octokit.repos.get({ owner: user, repo: repoName });
      branch = repo.default_branch || 'main';
    }

    // Try to fetch existing file's SHA (needed for updates)
    let sha;
    try {
      const { data } = await octokit.repos.getContent({
        owner: user, repo: repoName, path, ref: branch
      });
      sha = data.sha;
    } catch (e) {
      // 404 = file doesn't exist yet → new file, sha stays undefined
    }

    // 🎯 FIX: Build params, only include sha if it exists
    const params = {
      owner: user,
      repo: repoName,
      path,
      message,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      branch  // now always a real string
    };
    if (sha) params.sha = sha;

    const { data: result } = await octokit.repos.createOrUpdateFileContents(params);
    repoCache = null;
    return {
      ok: true,
      url: result.commit.html_url,
      sha: result.commit.sha.slice(0, 7)
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function createRepo(name, isPrivate, description = '') {
  if (!octokit) throw new Error('GitHub not configured');
  try {
    const { data } = await octokit.repos.createForAuthenticatedUser({
      name, private: isPrivate, description, auto_init: true
    });
    repoCache = null;
    return { ok: true, url: data.html_url, full_name: data.full_name };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function listWorkflows(repoName) {
  if (!octokit) throw new Error('GitHub not configured');
  try {
    const user = await me();
    const { data } = await octokit.actions.listRepoWorkflows({ owner: user, repo: repoName });
    return data.workflows.map(w => ({ name: w.name, state: w.state, path: w.path }));
  } catch { return []; }
}

function clearCache() { repoCache = null; repoCacheTs = 0; }

module.exports = {
  isConfigured, listRepos, repoDetails, listFiles,
  readFile, writeFile, createRepo, listWorkflows, clearCache
};
