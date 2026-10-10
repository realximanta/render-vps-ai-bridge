/**
 * 🧠 Intent matching — rules first, AI fallback
 */
const queue = require('./queue');

const RULES = [
  { re: /^(?:show|list|see|view|send|get|give)(?:\s+me)?(?:\s+(?:the|my|all|latest|recent|updated))*\s+repos?(?:itories)?\b/i, intent: 'list_repos' },
  { re: /^(?:create|make|start)(?:\s+a)?(?:\s+new)?\s+repo(?:sitory)?\s+(?:called\s+|named\s+)?["']?([\w.-]+)["']?/i, intent: 'create_repo', args: (m) => ({ name: m[1], private: false }) },
  { re: /^(?:create|make|start)(?:\s+a)?(?:\s+new)?\s+private\s+repo(?:sitory)?\s+(?:called\s+|named\s+)?["']?([\w.-]+)["']?/i, intent: 'create_repo', args: (m) => ({ name: m[1], private: true }) },
  { re: /^(?:add|create|generate|write|make)\s+(?:a\s+)?readme(?:\s+(?:for|to|in))?\s+["']?([\w.-]+)["']?/i, intent: 'generate_readme', args: (m) => ({ repo: m[1] }) },
  { re: /^(?:show|list|see)\s+files?\s+(?:in|for|of)\s+["']?([\w.-]+)["']?/i, intent: 'list_files', args: (m) => ({ repo: m[1] }) },
  { re: /^(?:show|get|give)(?:\s+me)?\s+info\s+(?:on|about|for)\s+["']?([\w.-]+)["']?/i, intent: 'repo_info', args: (m) => ({ repo: m[1] }) },
  { re: /^(?:clear|refresh)\s+cache\b/i, intent: 'clear_cache' },
];

function matchRule(text) {
  const t = text.trim();
  for (const r of RULES) {
    const m = t.match(r.re);
    if (m) return { intent: r.intent, args: r.args ? r.args(m) : {} };
  }
  return null;
}

function needsAgent(text) {
  const t = text.toLowerCase();
  const verbs = ['create', 'make', 'add', 'commit', 'push', 'update', 'write',
                 'generate', 'search', 'find', 'analyze'];
  let vCount = 0;
  for (const v of verbs) if (t.includes(v)) vCount++;
  if (vCount >= 2) return true;
  if (/\b(and then|after that|then also)\b/.test(t)) return true;
  return false;
}

function looksLikeCommand(text) {
  return /\b(repo|repos|repository|file|commit|readme|push|github|create|delete|list|show|send|update)\b/i.test(text);
}

const INTENT_PROMPT = `Output ONLY valid JSON, no markdown, no explanations.
Parse the user message into one of these intents:

- list_repos                                    (list repos)
- repo_info {repo}                              (info about repo)
- list_files {repo, path?}                      (list files)
- read_file {repo, path}                        (read file)
- create_repo {name, private, description?}     (create repo)
- write_file {repo, path, content, message?}    (write file)
- generate_readme {repo, description}           (write README)
- ask_ai {prompt}                               (chat/question)
- unknown

Examples:
"show my repos" -> {"intent":"list_repos","args":{}}
"send me latest repositories" -> {"intent":"list_repos","args":{}}
"create a repo called my-app" -> {"intent":"create_repo","args":{"name":"my-app","private":false}}
"add readme to my-app" -> {"intent":"generate_readme","args":{"repo":"my-app","description":"my-app"}}
"files in my-app" -> {"intent":"list_files","args":{"repo":"my-app"}}
"what is python" -> {"intent":"ask_ai","args":{"prompt":"what is python"}}
"hello" -> {"intent":"ask_ai","args":{"prompt":"hello"}}

User message: `;

async function parseIntent(text) {
  const result = await queue.aiJson(INTENT_PROMPT + JSON.stringify(text), 'code', 120000);
  if (!result || typeof result !== 'object' || !result.intent) return null;
  return result;
}

module.exports = { matchRule, needsAgent, looksLikeCommand, parseIntent };
