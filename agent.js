/**
 * 🤖 Multi-step GitHub agent
 */
const queue = require('./queue');
const github = require('./github');

const AGENT_MODEL = 'code';
const MAX_STEPS = 6;

const PROMPT = `You are a GitHub agent. Complete the task using tools.
Output ONLY valid JSON per turn. No markdown.

Tools:
{"tool":"list_repos","args":{}}
{"tool":"repo_info","args":{"repo":"name"}}
{"tool":"list_files","args":{"repo":"name","path":""}}
{"tool":"create_repo","args":{"name":"x","private":false,"description":"..."}}
{"tool":"write_file","args":{"repo":"name","path":"file.md","content":"...","message":"..."}}
{"tool":"finish","args":{"summary":"What was done"}}

Rules:
- One tool call per turn. Wait for RESULT.
- When task is done, use "finish".
- For README content: include # Title, ## Description, ## Features, ## Installation, ## Usage.

`;

async function executeTool(tool, args) {
  switch (tool) {
    case 'list_repos': {
      const repos = await github.listRepos();
      return repos.slice(0, 25).map(r => ({
        name: r.name, private: r.private, lang: r.language, desc: r.description
      }));
    }
    case 'repo_info': return await github.repoDetails(args.repo);
    case 'list_files': return (await github.listFiles(args.repo, args.path || '')).map(f => f.name);
    case 'create_repo': return await github.createRepo(args.name, !!args.private, args.description || '');
    case 'write_file': return await github.writeFile(args.repo, args.path, args.content, args.message || 'chore: bot commit');
    default: return { error: `unknown tool: ${tool}` };
  }
}

async function run(task, logCb, maxSteps = MAX_STEPS) {
  const history = [`TASK: ${task}`];
  const steps = [];

  for (let i = 0; i < maxSteps; i++) {
    const prompt = PROMPT + history.join('\n') + '\nNext tool call:';
    const result = await queue.aiJson(prompt, AGENT_MODEL, 180000);

    if (!result || !result.tool) {
      return { ok: false, error: 'AI failed to produce a valid tool call', history: steps };
    }
    const tool = result.tool;
    const args = result.args || {};
    steps.push({ tool, args });
    if (logCb) logCb(tool, args);

    if (tool === 'finish') {
      return { ok: true, summary: args.summary || 'Task completed.', history: steps };
    }

    let toolResult;
    try { toolResult = await executeTool(tool, args); }
    catch (e) { toolResult = { error: e.message }; }

    history.push(`CALL ${tool}(${JSON.stringify(args).slice(0, 200)})`);
    history.push(`RESULT: ${JSON.stringify(toolResult).slice(0, 1200)}`);
  }
  return { ok: false, error: 'Hit max steps without finishing', history: steps };
}

module.exports = { run };
