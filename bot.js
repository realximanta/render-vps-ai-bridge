/**
 * 💬 Telegram bot — Telegram-safe messaging + intent pipeline
 */
const { Telegraf, Markup } = require('telegraf');
const queue = require('./queue');
const github = require('./github');
const intent = require('./intent');
const agent = require('./agent');

const MODELS = {
  chat:   process.env.MODEL_CHAT || 'gemma3:1b',
  code:   process.env.MODEL_CODE || 'qwen2.5-coder:1.5b',
  readme: process.env.MODEL_CODE || 'qwen2.5-coder:1.5b'
};

const TG_LIMIT = 3900;
const FILE_LIMIT = 3400;
const ALLOWED_IDS = (process.env.TELEGRAM_ALLOWED_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean).map(Number);

const userState = new Map();
function st(id) {
  if (!userState.has(id)) userState.set(id, { model: 'chat' });
  return userState.get(id);
}

function isAllowed(ctx) { return ALLOWED_IDS.includes(ctx.chat.id); }

function chunk(text, limit = TG_LIMIT) {
  if (text.length <= limit) return [text];
  const out = [];
  let rem = text;
  while (rem.length) {
    if (rem.length <= limit) { out.push(rem); break; }
    let cut = rem.lastIndexOf('\n\n', limit);
    if (cut === -1) cut = rem.lastIndexOf('\n', limit);
    if (cut === -1) cut = rem.lastIndexOf(' ', limit);
    if (cut === -1) cut = limit;
    out.push(rem.slice(0, cut));
    rem = rem.slice(cut).replace(/^\n+/, '');
  }
  return out;
}

async function safeSend(ctx, text, extra = {}) {
  if (!text) text = '(empty)';
  if (text.length > FILE_LIMIT) {
    return ctx.replyWithDocument(
      { source: Buffer.from(text, 'utf-8'), filename: 'ai_response.txt' }, extra);
  }
  const parts = chunk(text);
  for (let i = 0; i < parts.length; i++) {
    const opts = i === 0 ? extra : {};
    try { await ctx.reply(parts[i], opts); }
    catch { try { await ctx.reply(parts[i]); } catch {} }
  }
}

function tgRules() {
  return ['OUTPUT RULES:',
    '- Reply shown in Telegram chat.',
    '- Keep under 3500 chars when possible.',
    '- Plain text. No tables, no HTML.',
    '- Use ``` only for code.',
    '- 0-3 emojis max.'].join('\n');
}

// ── Keyboards ──
function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📁 My Repos', 'menu:repos'),
     Markup.button.callback('🤖 AI Models', 'menu:models')],
    [Markup.button.callback('💬 Ask AI', 'menu:ask'),
     Markup.button.callback('➕ New Repo', 'menu:newrepo')],
    [Markup.button.callback('📊 Status', 'menu:status'),
     Markup.button.callback('🔄 Clear Cache', 'menu:clearcache')]
  ]);
}
function repoKeyboard(repos) {
  const rows = repos.slice(0, 15).map(r => [
    Markup.button.callback((r.private ? '🔒 ' : '🌐 ') + r.name, `repo:${r.name}`)
  ]);
  rows.push([Markup.button.callback('⬅️ Back', 'menu:home')]);
  return Markup.inlineKeyboard(rows);
}
function repoActions(n) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📄 Files', `action:files:${n}`),
     Markup.button.callback('✏️ Edit', `action:edit:${n}`)],
    [Markup.button.callback('➕ Add File', `action:add:${n}`),
     Markup.button.callback('📝 New README', `action:readme:${n}`)],
    [Markup.button.callback('🧠 Ask to AI', `action:ask:${n}`),
     Markup.button.callback('⚙️ Actions', `action:workflows:${n}`)],
    [Markup.button.callback('🔄 Refresh', `action:refresh:${n}`),
     Markup.button.callback('🔗 Open', `action:open:${n}`)],
    [Markup.button.callback('⬅️ Back', 'menu:repos')]
  ]);
}
function modelsKb(cur) {
  const rows = Object.entries(MODELS).map(([k, v]) => [
    Markup.button.callback(`${k === cur ? '✅ ' : '◻️ '}${k} → ${v}`, `model:${k}`)
  ]);
  rows.push([Markup.button.callback('⬅️ Back', 'menu:home')]);
  return Markup.inlineKeyboard(rows);
}
function cancelKb() {
  return Markup.inlineKeyboard([[Markup.button.callback('⬅️ Cancel', 'menu:home')]]);
}

// ── Intent executor ──
async function executeIntent(ctx, name, args = {}) {
  const m = st(ctx.chat.id);
  switch (name) {
    case 'list_repos': {
      const status = await ctx.reply('⏳ Loading repos...');
      try {
        const repos = await github.listRepos();
        await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
        if (!repos.length) return ctx.reply('📭 No repos.');
        const lines = repos.slice(0, 12).map(r => {
          const icon = r.private ? '🔒' : '🌐';
          return `${icon} ${r.name}  ·  ${r.language}  ·  ${r.updated.slice(0,10)}\n   💬 ${r.last_commit}`;
        });
        return ctx.reply(`📁 Your Repos (${repos.length}):\n\n${lines.join('\n\n')}`, repoKeyboard(repos));
      } catch (e) {
        await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
        return ctx.reply(`❌ ${e.message}`);
      }
    }
    case 'repo_info': {
      const info = await github.repoDetails(args.repo || '');
      if (!info) return ctx.reply(`❌ Repo not found: ${args.repo}`);
      m.repo = info.name;
      return ctx.reply(
        `${info.private ? '🔒' : '🌐'} ${info.name}\n\n📝 ${info.description}\n` +
        `🌿 ${info.default_branch}\n💻 ${info.language}\n⭐ ${info.stars}\n🔗 ${info.url}`,
        repoActions(info.name));
    }
    case 'list_files': {
      const files = await github.listFiles(args.repo || '', args.path || '');
      if (!files.length) return ctx.reply(`📂 Empty/not found: ${args.repo}`);
      const lines = files.slice(0, 30).map(f =>
        `${f.type === 'dir' ? '📁' : '📄'} ${f.name}`);
      return ctx.reply(`📂 ${args.repo}:\n\n${lines.join('\n')}`);
    }
    case 'read_file': {
      const content = await github.readFile(args.repo || '', args.path || '');
      if (content === null) return ctx.reply('❌ File not found.');
      return safeSend(ctx, `📄 ${args.repo}/${args.path}:\n\n${content}`);
    }
    case 'create_repo': {
      if (!args.name) return ctx.reply('❌ No repo name.');
      const status = await ctx.reply(`⏳ Creating ${args.name}...`);
      const r = await github.createRepo(args.name, !!args.private, args.description || '');
      const txt = r.ok ? `✅ Repo created: ${r.full_name}\n\n🔗 ${r.url}` : `❌ ${r.error}`;
      return ctx.telegram.editMessageText(ctx.chat.id, status.message_id, null, txt)
        .catch(() => ctx.reply(txt));
    }
    case 'write_file': {
      const r = await github.writeFile(args.repo || '', args.path || '', args.content || '',
                                        args.message || 'chore: bot commit');
      return ctx.reply(r.ok ? `✅ Pushed ${args.path}\n🔗 ${r.url}` : `❌ ${r.error}`);
    }
    case 'generate_readme': {
  const repo = args.repo || '';
  const status = await ctx.reply(`📝 Generating README for ${repo}...`);

  // 🎯 FIX 1: Read the CURRENT README first
  const existing = await github.readFile(repo, 'README.md') || '';

  // 🎯 FIX 2: Also list the repo's files so AI understands the project
  let fileList = [];
  try { fileList = (await github.listFiles(repo)).map(f => f.name); } catch {}

  const context = existing
    ? `Here is the CURRENT README:\n\n---\n${existing.slice(0, 3000)}\n---\n\n`
    : `The repo has no README yet. Files: ${fileList.join(', ') || '(empty)'}\n\n`;

  const p = [
    tgRules(),
    '',
    'You are a professional technical writer.',
    'Your job: produce a COMPLETE, high-quality README.md in Markdown.',
    'Output ONLY the raw README content — no fences, no explanations.',
    '',
    'HARD RULES:',
    '- NEVER output just the user\'s instruction as content.',
    '- Preserve all valuable info from the current README.',
    '- If the user asks for badges, ADD valid shields.io badges at the top.',
    '- Include: # Title, short description, ## Features, ## Installation, ## Usage, ## License.',
    '- Keep it under 4000 chars.',
    '',
    context,
    `USER INSTRUCTION: ${args.description || 'Write/update the README'}`,
    '',
    'Now output the FULL README.md:'
  ].join('\n');

  const content = await queue.aiSync(p, 'readme');

  // 🎯 FIX 3: Sanity check — refuse to push garbage
  if (!content || content.trim().length < 100) {
    const msg = `❌ AI produced bad output (${content?.length || 0} chars). Not pushed.\n\nPreview: ${content?.slice(0, 200) || '(empty)'}`;
    return ctx.telegram.editMessageText(ctx.chat.id, status.message_id, null, msg)
      .catch(() => ctx.reply(msg));
  }

  // 🎯 FIX 4: Show preview & ask for confirmation
  const preview = content.slice(0, 500) + (content.length > 500 ? '…' : '');
  await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, null,
    `📝 Preview (${content.length} chars):\n\n${preview}\n\n⚠️ Send /yes to push, /no to cancel.`
  ).catch(() => {});

  // Store pending action
  const m = st(ctx.chat.id);
  m.pendingWrite = { repo, path: 'README.md', content, message: 'docs: update README [bot]' };
  return;
}
    case 'clear_cache': {
      github.clearCache();
      return ctx.reply('🔄 Cache cleared.', mainMenu());
    }
    case 'ask_ai':
      return askAiFlow(ctx, args.prompt || '', m.model);
    default:
      return ctx.reply(`🤷 Unknown intent: ${name}`);
  }
}

async function askAiFlow(ctx, prompt, model) {
  const status = await ctx.reply(`🧠 Thinking with ${model}...`);
  const full = `${tgRules()}\nUser: ${prompt}`;
  const result = await queue.aiSync(full, model);
  await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
  if (!result) return ctx.reply('⏱️ Timeout.', mainMenu());
  return safeSend(ctx, result, mainMenu());
}

async function runAgentFlow(ctx, task) {
  const status = await ctx.reply(`🤖 Agent starting...\n\n${task}`);
  const steps = [];
  const logCb = (tool, args) => {
    steps.push(`${tool}(${JSON.stringify(args).slice(0, 60)})`);
    ctx.telegram.editMessageText(ctx.chat.id, status.message_id, null,
      `🤖 Working...\n\n${steps.slice(-4).join('\n')}`).catch(() => {});
  };
  const result = await agent.run(task, logCb);
  await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
  if (result.ok) return safeSend(ctx, '✅ ' + result.summary, mainMenu());
  const hist = (result.history || []).map(s =>
    `  • ${s.tool} ${JSON.stringify(s.args).slice(0, 80)}`).join('\n');
  return ctx.reply(`⚠️ ${result.error}\n\nSteps tried:\n${hist}`, mainMenu());
}

// ── Bot factory ──
function createBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
  const bot = new Telegraf(token);

  // 1️⃣ AUTH FIRST — protects everything below
  bot.use(async (ctx, next) => {
    if (!ctx.chat) return;
    if (!isAllowed(ctx)) {
      if (ctx.message) await ctx.reply(`🚫 Unauthorized.\nYour chat ID: ${ctx.chat.id}`);
      return;
    }
    return next();
  });

  // 2️⃣ /yes and /no for pending writes
  bot.command('yes', async (ctx) => {
    const m = st(ctx.chat.id);
    if (!m.pendingWrite) return ctx.reply('Nothing pending.', mainMenu());
    const { repo, path, content, message } = m.pendingWrite;
    m.pendingWrite = null;

    const status = await ctx.reply('⏳ Pushing...');
    const r = await github.writeFile(repo, path, content, message);
    const txt = r.ok ? `🎉 Pushed ${path} to ${repo}\n🔗 ${r.url}` : `❌ ${r.error}`;
    return ctx.telegram.editMessageText(ctx.chat.id, status.message_id, null, txt)
      .catch(() => ctx.reply(txt));
  });

  bot.command('no', async (ctx) => {
    const m = st(ctx.chat.id);
    m.pendingWrite = null;
    return ctx.reply('❌ Cancelled.', mainMenu());
  });

  // 3️⃣ Commands
  bot.start(async (ctx) => {
    const m = st(ctx.chat.id);
    await ctx.reply(
      `🤖 AI Command Center\n\nActive model: ${m.model} → ${MODELS[m.model]}\n\n` +
      `💡 Just type what you want:\n` +
      `• show my repos\n` +
      `• send me latest updated repositories\n` +
      `• create a repo called my-app\n` +
      `• add readme to my-app\n` +
      `• make a portfolio repo and write a README`,
      mainMenu());
  });

  bot.command('menu', (ctx) => ctx.reply('🤖 Main menu', mainMenu()));

  // 4️⃣ Menu actions
  bot.action(/^menu:(.+)$/, async (ctx) => {
    const a = ctx.match[1];
    await ctx.answerCbQuery();
    const m = st(ctx.chat.id);

    if (a === 'home') return ctx.editMessageText(
      `🤖 AI Command Center\n\nActive model: ${m.model} → ${MODELS[m.model]}`, mainMenu())
      .catch(() => {});

    if (a === 'repos') {
      await ctx.editMessageText('⏳ Loading repos...').catch(() => {});
      try {
        const repos = await github.listRepos();
        if (!repos.length) return ctx.editMessageText('📭 No repos.', mainMenu());
        const lines = repos.slice(0, 10).map(r =>
          `${r.private ? '🔒' : '🌐'} ${r.name}  ·  ${r.updated.slice(0,10)}`);
        return ctx.editMessageText(`📁 Your Repos (${repos.length}):\n\n${lines.join('\n')}`,
          repoKeyboard(repos));
      } catch (e) { return ctx.editMessageText(`❌ ${e.message}`, mainMenu()); }
    }

    if (a === 'models') return ctx.editMessageText(
      `🤖 AI Models\n\nCurrent: ${m.model} → ${MODELS[m.model]}\n\nTap to switch:`,
      modelsKb(m.model));

    if (a === 'status') {
      const s = queue.stats();
      const gh = github.isConfigured() ? '✅' : '❌';
      return ctx.editMessageText(
        `📊 Status\n\n🔗 GitHub: ${gh}\n📥 Total jobs: ${s.total_jobs}\n⏳ Pending: ${s.pending_jobs}`,
        mainMenu());
    }
    if (a === 'clearcache') {
      github.clearCache();
      return ctx.editMessageText('🔄 Cache cleared.', mainMenu());
    }
    if (a === 'newrepo') {
      m.awaitingNewRepo = true;
      return ctx.editMessageText('➕ Create New Repo\n\nSend the repo name:', cancelKb());
    }
    if (a === 'ask') {
      m.awaitingPrompt = true;
      return ctx.editMessageText(
        `💬 Ask AI\n\nModel: ${m.model} → ${MODELS[m.model]}\n\nSend your prompt:`, cancelKb());
    }
  });

  bot.action(/^model:(.+)$/, async (ctx) => {
    const k = ctx.match[1];
    await ctx.answerCbQuery();
    st(ctx.chat.id).model = k;
    return ctx.editMessageText(`✅ Model set to: ${k} → ${MODELS[k]}`, mainMenu());
  });

  bot.action(/^repo:(.+)$/, async (ctx) => {
    const name = ctx.match[1];
    await ctx.answerCbQuery();
    const info = await github.repoDetails(name);
    if (!info) return ctx.editMessageText(`❌ ${name} not found.`, mainMenu());
    st(ctx.chat.id).repo = name;
    const txt = `${info.private ? '🔒' : '🌐'} ${info.name}\n\n📝 ${info.description.slice(0,200)}\n` +
                `🌿 ${info.default_branch}\n💻 ${info.language}\n⭐ ${info.stars}  🍴 ${info.forks}\n🔗 ${info.url}`;
    return ctx.editMessageText(txt, repoActions(name));
  });

  bot.action(/^action:([^:]+):(.+)$/, async (ctx) => {
    const a = ctx.match[1], name = ctx.match[2];
    await ctx.answerCbQuery();
    const m = st(ctx.chat.id);

    if (a === 'files') {
      const files = await github.listFiles(name);
      if (!files.length) return ctx.editMessageText(`📂 ${name} empty.`, repoActions(name));
      const lines = files.slice(0, 30).map(f =>
        `${f.type === 'dir' ? '📁' : '📄'} ${f.name}`);
      return ctx.editMessageText(`📂 ${name} — ${files.length} items\n\n${lines.join('\n')}`,
        repoActions(name));
    }
    if (a === 'refresh') return ctx.editMessageReplyMarkup(repoActions(name).reply_markup);
    if (a === 'open') {
      const info = await github.repoDetails(name);
      if (info) return ctx.reply(info.url);
      return;
    }
    if (a === 'edit') {
      m.awaitingEditPath = { mode: 'edit', repo: name };
      return ctx.editMessageText(`✏️ Edit File in ${name}\n\nSend the file path:`, cancelKb());
    }
    if (a === 'add') {
      m.awaitingEditPath = { mode: 'add', repo: name };
      return ctx.editMessageText(`➕ Add File to ${name}\n\nSend the file path:`, cancelKb());
    }
    if (a === 'readme') {
      m.awaitingReadme = { repo: name };
      return ctx.editMessageText(
        `📝 Generate README for ${name}\n\nSend a short description:`, cancelKb());
    }
    if (a === 'ask') {
      m.awaitingRepoPrompt = { repo: name };
      return ctx.editMessageText(
        `🧠 Ask AI about ${name}\n\nModel: ${m.model}\n\nSend your prompt:`, cancelKb());
    }
    if (a === 'workflows') {
      const wfs = await github.listWorkflows(name);
      const lines = wfs.length ? wfs.map(w => `  • ${w.name} [${w.state}]`) : ['  (none)'];
      return ctx.editMessageText(`⚙️ Actions in ${name}\n\n${lines.join('\n')}`, repoActions(name));
    }
  });

  // 5️⃣ Text handler (intent pipeline)
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text) return;
    const m = st(ctx.chat.id);

    if (m.awaitingNewRepo) {
      m.awaitingNewRepo = false;
      const name = text.replace(/\s+/g, '-').toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) return ctx.reply('❌ Invalid name.', mainMenu());
      const status = await ctx.reply(`⏳ Creating ${name}...`);
      const r = await github.createRepo(name, false, '');
      const txt = r.ok ? `✅ Created!\n\n🔗 ${r.url}` : `❌ ${r.error}`;
      return ctx.telegram.editMessageText(ctx.chat.id, status.message_id, null, txt)
        .catch(() => ctx.reply(txt));
    }
    if (m.awaitingPrompt) {
      m.awaitingPrompt = false;
      return askAiFlow(ctx, text, m.model);
    }
    if (m.awaitingEditPath) {
      const { mode, repo } = m.awaitingEditPath;
      m.awaitingEditPath = null;
      m.awaitingEditContent = { mode, repo, path: text };
      const current = await github.readFile(repo, text);
      const preview = current
        ? `\n\n📄 Current:\n${current.slice(0, 400)}${current.length > 400 ? '…' : ''}`
        : '\n\n🆕 New file';
      return ctx.reply(`${preview}\n\nSend:\n• RAW: <content> → overwrite\n• or a prompt → AI generates it`,
        cancelKb());
    }
    if (m.awaitingEditContent) {
      const { mode, repo, path } = m.awaitingEditContent;
      m.awaitingEditContent = null;
      if (text.startsWith('RAW:')) {
        const content = text.slice(4).replace(/^\s/, '');
        const status = await ctx.reply('⏳ Committing...');
        const r = await github.writeFile(repo, path, content, `chore: ${mode} ${path} [bot]`);
        const txt = r.ok ? `✅ Pushed ${path}\n🔗 ${r.url}` : `❌ ${r.error}`;
        return ctx.telegram.editMessageText(ctx.chat.id, status.message_id, null, txt)
          .catch(() => ctx.reply(txt));
      }
      const status = await ctx.reply(`🧠 AI writing ${path}...`);
      const p = `${tgRules()}\nYou are a programmer. Output ONLY raw file content.\n\nFile: ${path}\nTask: ${text}`;
      const content = await queue.aiSync(p, 'code');
      if (!content) return ctx.telegram.editMessageText(ctx.chat.id, status.message_id, null, '❌ AI failed.')
        .catch(() => ctx.reply('❌ AI failed.'));
      const push = await github.writeFile(repo, path, content, `feat: AI ${mode} ${path} [bot]`);
      const txt = push.ok ? `🎉 Pushed ${path}\n🔗 ${push.url}` : `❌ ${push.error}`;
      return ctx.telegram.editMessageText(ctx.chat.id, status.message_id, null, txt)
        .catch(() => ctx.reply(txt));
    }
    if (m.awaitingReadme) {
      const { repo } = m.awaitingReadme;
      m.awaitingReadme = null;
      return executeIntent(ctx, 'generate_readme', { repo, description: text });
    }
    if (m.awaitingRepoPrompt) {
      const { repo } = m.awaitingRepoPrompt;
      m.awaitingRepoPrompt = null;
      const status = await ctx.reply('🧠 Asking AI...');
      const p = `${tgRules()}\nContext: repo ${repo}\nUser: ${text}`;
      const result = await queue.aiSync(p, m.model);
      await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
      if (!result) return ctx.reply('⏱️ Timeout.');
      return safeSend(ctx, result, repoActions(repo));
    }

    // Intent pipeline
    const rule = intent.matchRule(text);
    if (rule) return executeIntent(ctx, rule.intent, rule.args);

    if (intent.needsAgent(text)) return runAgentFlow(ctx, text);

    if (intent.looksLikeCommand(text)) {
      const parsed = await intent.parseIntent(text);
      if (parsed && parsed.intent && parsed.intent !== 'unknown') {
        return executeIntent(ctx, parsed.intent, parsed.args || {});
      }
    }

    return askAiFlow(ctx, text, m.model);
  });

  return bot;
}

module.exports = { createBot };
