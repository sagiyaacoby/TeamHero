  // ── Help Section ─────────────────────────────────────
  var helpTopics = [
    {
      title: 'How TeamHero Works',
      icon: '&#9733;',
      content: '<h2>How TeamHero Works</h2>' +
        '<p>TeamHero is an <strong>AI agent team management platform</strong>. You manage a team of AI agents the same way you' + q + 'd manage a team of people - by assigning work, reviewing results, and giving feedback.</p>' +
        '<h3>The Three Layers</h3>' +
        '<ol>' +
        '<li><strong>You (the Owner)</strong> - You set goals, review deliverables, and provide feedback. You talk to the orchestrator through the Command Center.</li>' +
        '<li><strong>The Orchestrator (Hero)</strong> - Your team lead. It takes your instructions, breaks them into tasks, assigns them to the right agents, and makes sure work gets done. It never does the work itself - it delegates.</li>' +
        '<li><strong>Agents (the Team)</strong> - Specialized AI workers, each with their own role, personality, and memory. A developer, a researcher, a content writer - whatever your project needs.</li>' +
        '</ol>' +
        '<h3>The Workflow</h3>' +
        '<ol>' +
        '<li>You tell the orchestrator what you need in the Command Center</li>' +
        '<li>The orchestrator creates tasks and assigns them to agents</li>' +
        '<li>Agents do the work and submit it for your review</li>' +
        '<li>You accept good work or send feedback to improve it</li>' +
        '<li>Accepted work is closed automatically</li>' +
        '</ol>' +
        '<p>Think of it as a project management tool where your employees are AI agents that work instantly, 24/7, and get better over time.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'chat\')">Go to Command Center &#8594;</button>'
    },
    {
      title: 'Command Center',
      icon: '&#9654;',
      content: '<h2>Command Center</h2>' +
        '<p>The Command Center is your <strong>terminal interface</strong> to the orchestrator. This is where you give instructions, ask questions, and manage your team. Everything starts here.</p>' +
        '<h3>What You Can Do</h3>' +
        '<ul>' +
        '<li><code>Run a round table</code> - Trigger a full team review. The orchestrator will close completed work, launch agents on pending tasks, surface blockers, and give you a status report.</li>' +
        '<li><code>Create a task for Dev to build a login page</code> - Create and assign work directly to an agent.</li>' +
        '<li><code>Build me a team with a Content Writer and a QA Tester</code> - Create multiple agents at once.</li>' +
        '<li><code>What is Scout working on?</code> - Check any agent' + q + 's current status.</li>' +
        '<li><code>Research competitor pricing</code> - The orchestrator decides which agent is best and delegates.</li>' +
        '</ul>' +
        '<h3>Tips</h3>' +
        '<ul>' +
        '<li>Be specific about what you want - the orchestrator delegates to the right agent</li>' +
        '<li>You can reference agents by name</li>' +
        '<li>The orchestrator never does agent work itself - it always delegates via tasks</li>' +
        '<li>Use <strong>Ctrl+C</strong> to copy selected text, <strong>Ctrl+V</strong> to paste text, <strong>Ctrl+G</strong> to open an editor for multiline input</li>' +
        '</ul>' +
        '<button class="help-go-link" onclick="App.navigate(\'chat\')">Go to Command Center &#8594;</button>'
    },
    {
      title: 'Dashboard & Views',
      icon: '&#9632;',
      content: '<h2>Dashboard &amp; Views</h2>' +
        '<p>The Dashboard is your <strong>mission control</strong>. It shows all tasks, their statuses, and the latest round table summary. It defaults to showing <strong>Pending</strong> tasks - everything needing your attention.</p>' +
        '<h3>Tab Cards</h3>' +
        '<p>Click any tab card to filter: <strong>Pending</strong> (planning/pending approval), <strong>Working</strong>, <strong>Done</strong>, <strong>Hold</strong>, <strong>Cancelled</strong>, or <strong>Closed</strong>. The pending count includes subtasks so nothing slips through.</p>' +
        '<h3>View Modes</h3>' +
        '<ul>' +
        '<li><strong>Tree</strong> (default) - Hierarchical view showing parent tasks with their subtasks nested below. Expandable/collapsible.</li>' +
        '<li><strong>Flow</strong> - Visual dependency graph showing how tasks connect. Nodes pulse when in progress, dim when done, glow when pending. Hover any node to highlight its upstream and downstream chain.</li>' +
        '</ul>' +
        '<h3>Agent Filter Bar</h3>' +
        '<p>The filter bar above the task list lets you <strong>filter tasks by agent</strong>. Click an agent name to show only their tasks. Click again to clear the filter. This works across all view modes.</p>' +
        '<h3>Agent Tooltip</h3>' +
        '<p>Hover over any agent name in the sidebar to see a <strong>tooltip with their role description</strong>. A quick way to remember who does what without opening the agent page.</p>' +
        '<h3>Round Table Summary</h3>' +
        '<p>The right panel shows the latest round table report - what was executed, what needs your attention, and overall team status.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'dashboard\')">Go to Dashboard &#8594;</button>'
    },
    {
      title: 'Tasks & Lifecycle',
      icon: '&#9998;',
      content: '<h2>Tasks &amp; Lifecycle</h2>' +
        '<p>Tasks are <strong>work units</strong> assigned to agents. Every piece of work flows through a clear lifecycle so nothing gets lost.</p>' +
        '<h3>Status Flow</h3>' +
        '<p><strong>Working &rarr; Pending &rarr; Accepted/Improve &rarr; Working &rarr; Closed</strong></p>' +
        '<ul>' +
        '<li><strong>Working</strong> - Agent is actively doing work. When a task is created, the agent begins immediately by preparing a plan or draft.</li>' +
        '<li><strong>Pending</strong> - Agent submitted work for your review. You can <strong>Accept</strong> or <strong>Improve</strong>.</li>' +
        '<li><strong>Accepted</strong> - You approved the work. The orchestrator launches the agent to execute, then closes it automatically.</li>' +
        '<li><strong>Improve</strong> - You sent feedback. The agent revises and resubmits to Pending.</li>' +
        '<li><strong>Closed</strong> - Done. Terminal state. No further work.</li>' +
        '<li><strong>Hold</strong> - Paused. Agent will not touch it until released.</li>' +
        '<li><strong>Cancelled</strong> - Abandoned. No further action.</li>' +
        '</ul>' +
        '<h3>Two-Phase Pending Flow</h3>' +
        '<p>A task goes through <strong>Pending twice</strong>:</p>' +
        '<ol>' +
        '<li><strong>First Pending (Plan/Draft)</strong> - The agent prepares materials, a plan, or a draft and submits for review. You review the approach before any execution happens.</li>' +
        '<li><strong>Second Pending (Proof)</strong> - After you accept, the agent executes the approved work and submits proof (URLs, file paths, test results). You verify the outcome and the task closes.</li>' +
        '</ol>' +
        '<p>This ensures you always see what will be done before it happens, and verify the results after.</p>' +
        '<h3>Inline Improve</h3>' +
        '<p>When previewing a deliverable file or image, you can click <strong>Improve</strong> directly from the preview modal. Type your feedback right there - no need to go back to the task page first.</p>' +
        '<h3>Confirmation Dialogs</h3>' +
        '<p><strong>Improve</strong> shows a confirmation dialog before executing, giving you a chance to add feedback text. <strong>Accept</strong> executes immediately for a frictionless workflow. Toggling <strong>Autopilot ON</strong> requires confirmation since it lets agents execute without approval.</p>' +
        '<h3>Auto-Trigger</h3>' +
        '<p>When you click Accept or Improve, the orchestrator is <strong>immediately notified</strong> via the CLI. You do not need to run a round table or manually tell it - the agent picks up the work right away.</p>' +
        '<h3>Subtasks &amp; Dependencies</h3>' +
        '<p>Tasks can have subtasks assigned to different agents, and tasks can depend on other tasks. When all subtasks are done, the parent auto-advances. Blocked tasks (waiting on dependencies) show a lock icon.</p>' +
        '<p>Use subtasks when a goal requires <strong>multiple agents or phases</strong>. For example, a launch campaign might have a research subtask (Scout), a content subtask (Pen), and a development subtask (Dev). The parent task tracks the overall goal while subtasks track individual contributions.</p>' +
        '<h3>Task Modes</h3>' +
        '<p>Tasks operate in one of three modes:</p>' +
        '<ol>' +
        '<li><strong>Manual</strong> (no icon) - Standard lifecycle. Agent plans, you review, agent executes, you verify.</li>' +
        '<li><strong>Autopilot</strong> (&#9881; gear icon) - Agent delivers, orchestrator auto-advances to done without your review. Toggle on the task detail page.</li>' +
        '<li><strong>Timed</strong> (&#128339; clock icon) - Scheduled tasks, either recurring on an interval or one-time at a specific date/time. Timed tasks are always autopilot (locked). Manage schedules from the Autopilot page or task detail.</li>' +
        '</ol>' +
        '<button class="help-go-link" onclick="App.navigate(\'dashboard\')">View Tasks &#8594;</button>'
    },
    {
      title: 'Round Tables',
      icon: '&#9679;',
      content: '<h2>Round Tables</h2>' +
        '<p>Round Tables are <strong>execution-first team reviews</strong>. They are the heartbeat of your team - run them regularly to keep work moving.</p>' +
        '<h3>What Happens (In Order)</h3>' +
        '<p><strong>Phase 1: Execute</strong> - The orchestrator acts before it reports:</p>' +
        '<ul>' +
        '<li>Launches agents on working tasks to execute</li>' +
        '<li>Launches agents on planning tasks that have your feedback</li>' +
        '<li>Starts agents on any ready tasks that haven' + q + 't been picked up</li>' +
        '<li>Flags stalled work with no recent progress</li>' +
        '</ul>' +
        '<p><strong>Phase 2: Surface Blockers</strong></p>' +
        '<ul>' +
        '<li>Tasks stuck waiting on unmet dependencies</li>' +
        '<li>Tasks with no recent progress that may be stalled</li>' +
        '<li>Tasks that need your decision (pending review)</li>' +
        '<li>Agents with no active tasks (available capacity)</li>' +
        '</ul>' +
        '<p><strong>Phase 3: Report</strong></p>' +
        '<ul>' +
        '<li>Brief summary of what was just executed</li>' +
        '<li>What needs your decision</li>' +
        '<li>Knowledge base review - stale docs flagged</li>' +
        '</ul>' +
        '<h3>How to Trigger</h3>' +
        '<p>Type <code>Run a round table</code> in the Command Center, or click the <strong>Round Table</strong> button on the Dashboard or Command Center header.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'dashboard\')">Go to Dashboard &#8594;</button>'
    },
    {
      title: 'Agents',
      icon: '&#9670;',
      content: '<h2>Agents</h2>' +
        '<p>Agents are <strong>AI team members</strong>. Each has a distinct role, personality, rules, and memory. They execute tasks autonomously and improve over time as they learn your preferences.</p>' +
        '<h3>Agent Properties</h3>' +
        '<ul>' +
        '<li><strong>Role</strong> - Their job title and area of expertise (e.g. Full-Stack Developer, Researcher)</li>' +
        '<li><strong>Personality</strong> - Traits, tone, and communication style that shape their output</li>' +
        '<li><strong>Rules</strong> - Guidelines specific to this agent' + q + 's domain</li>' +
        '<li><strong>Capabilities</strong> - Skills and tools they can use</li>' +
        '</ul>' +
        '<h3>Agent Memory</h3>' +
        '<p>Each agent has two memory banks that persist across conversations:</p>' +
        '<ul>' +
        '<li><strong>Short Memory</strong> - Current context, active work, and recent round table outcomes. Gets refreshed regularly.</li>' +
        '<li><strong>Long Memory</strong> - Persistent knowledge, your preferences, and lessons learned over time.</li>' +
        '</ul>' +
        '<h3>The Orchestrator</h3>' +
        '<p>The orchestrator (Hero) is a special agent that manages the team. It never does work itself - it plans, delegates, coordinates, and reports. You talk to it through the Command Center, and it talks to agents via tasks.</p>' +
        '<h3>Creating Agents</h3>' +
        '<p>Use the Add Agent page, or ask the orchestrator: <code>Build me a team with a Content Writer, a QA Tester, and a Designer</code></p>' +
        '<button class="help-go-link" onclick="App.navigate(\'add-agent\')">Add New Agent &#8594;</button>'
    },
    {
      title: 'Autopilot',
      icon: '&#9881;',
      content: '<h2>Autopilot</h2>' +
        '<p>Autopilot enables <strong>autonomous task execution</strong> - work that runs without your review in the loop.</p>' +
        '<h3>Two Types of Autopilot</h3>' +
        '<p><strong>1. Task-level autopilot</strong> - Toggle autopilot on any individual task. The agent delivers, the orchestrator auto-accepts and closes. No owner review needed. Good for routine or low-risk work.</p>' +
        '<p><strong>2. Scheduled autopilot</strong> - Create recurring schedules that fire automatically on an interval. Assign a prompt to an agent, set how often it runs (minutes, hours, days), and let it go. Good for daily standups, periodic research, content generation, or system checks.</p>' +
        '<h3>Safety</h3>' +
        '<p>Autopilot tasks still appear in the dashboard with a gear icon so you can monitor them. Use <strong>Pause All</strong> to instantly stop all schedules if needed. You can toggle autopilot off on any task at any time to re-enable human review.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'autopilot\')">Go to Autopilot &#8594;</button>'
    },
    {
      title: 'Knowledge Base',
      icon: '&#9776;',
      content: '<h2>Knowledge Base</h2>' +
        '<p>The Knowledge Base is a <strong>library of research and reference documents</strong> created by your agents. It' + q + 's the team' + q + 's institutional memory.</p>' +
        '<h3>How It Works</h3>' +
        '<ul>' +
        '<li>When a research task is completed, its deliverable can be <strong>promoted to the Knowledge Base</strong></li>' +
        '<li>Documents are categorized: Research, Analysis, Reference, or Guide</li>' +
        '<li>Tag documents for easy filtering and discovery</li>' +
        '<li>Agents can reference knowledge base docs in future work</li>' +
        '</ul>' +
        '<h3>Staleness</h3>' +
        '<p>Documents older than 30 days are flagged as stale during round tables. The orchestrator will ask you whether to update, archive, or keep them.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'knowledge\')">Go to Knowledge Base &#8594;</button>'
    },
    {
      title: 'Media Library',
      icon: '&#9634;',
      content: '<h2>Media Library</h2>' +
        '<p>The Media Library stores <strong>images, screenshots, videos, and documents</strong> from your team' + q + 's work.</p>' +
        '<h3>Features</h3>' +
        '<ul>' +
        '<li><strong>Thumbnails</strong> - Image files show visual previews</li>' +
        '<li><strong>Preview</strong> - Click any file to preview it in the browser</li>' +
        '<li><strong>Open in Folder</strong> - Jump to the file on your system</li>' +
        '<li><strong>Filter</strong> - Browse by type: Images, Documents, Video, or All</li>' +
        '</ul>' +
        '<p>Files are stored in <code>data/media/</code>. Agents save screenshots, generated images, and other assets here automatically.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'media\')">Go to Media Library &#8594;</button>'
    },
    {
      title: 'Skills & Connectors',
      icon: '&#9670;',
      content: '<h2>Skills &amp; Connectors</h2>' +
        '<p>Skills extend what your agents can do by connecting them to <strong>external tools and services</strong>.</p>' +
        '<h3>Skill Types</h3>' +
        '<ul>' +
        '<li><strong>MCP Skills</strong> - Model Context Protocol integrations that give agents direct tool access (e.g. Playwright for browser control, Trello for project boards)</li>' +
        '<li><strong>CLI Skills</strong> - Command-line tools agents can invoke (e.g. screen recording with ffmpeg, video creation with Remotion)</li>' +
        '</ul>' +
        '<h3>Managing Skills</h3>' +
        '<ul>' +
        '<li>Enable/disable skills with a toggle</li>' +
        '<li>Some skills require configuration (API keys, tokens)</li>' +
        '<li>Dependencies are installed automatically when you enable a skill</li>' +
        '</ul>' +
        '<button class="help-go-link" onclick="App.navigate(\'skills\')">Go to Skills &#8594;</button>'
    },
    {
      title: 'Security & Secrets',
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
      content: '<h2>Security &amp; Secrets</h2>' +
        '<p>TeamHero runs <strong>100% locally</strong> on your machine. No cloud, no external servers, no telemetry. Your data never leaves your computer unless you explicitly tell an agent to post or send something.</p>' +
        '<h3>Agent Sandbox - What You Need to Know</h3>' +
        '<p>Agents are instructed to stay within the project folder and follow security rules. However, <strong>this is enforced by rules, not by a technical sandbox</strong>. Agents run as Claude Code subprocesses with the same OS permissions as your user account. In theory, an agent could access files or run commands outside the project if it ignored its instructions.</p>' +
        '<p>The layers of protection:</p>' +
        '<ul>' +
        '<li><strong>CLAUDE.md safety boundaries</strong> - Every agent session includes strict rules: stay within the project root, never modify platform files, no destructive system commands. Claude follows these reliably.</li>' +
        '<li><strong>Security rules</strong> - Explicitly ban directory traversal, system file access, and dangerous commands (rm -rf, shutdown, kill, etc.).</li>' +
        '<li><strong>Supervised mode</strong> - In supervised mode, Claude Code prompts you for confirmation before file writes and shell commands outside the project. This is the strongest guard available.</li>' +
        '<li><strong>Autonomous mode</strong> - No confirmation prompts. The only protection is the AI following its rules. Faster, but you are trusting the instructions to hold.</li>' +
        '</ul>' +
        '<p><strong>Recommendation:</strong> If your machine has sensitive files outside the project, use <strong>supervised mode</strong>. Use autonomous mode only when you trust the workflow and have reviewed your agent rules. You can switch modes anytime in Settings.</p>' +
        '<h3>Two Storage Systems</h3>' +
        '<p>TeamHero has two separate systems for storing sensitive information:</p>' +
        '<ul>' +
        '<li><strong>Secrets Vault</strong> - For <strong>API keys, tokens, and service credentials</strong>. Encrypted with AES-256-GCM. Injected as environment variables (e.g. <code>$TRELLO_API_KEY</code>). Managed in Settings &gt; Secrets &amp; API Keys.</li>' +
        '<li><strong>Credentials Manager</strong> - For <strong>website login credentials</strong> (service name, username, password). Injected as paired environment variables: <code>{SERVICE}_USERNAME</code> and <code>{SERVICE}_PASSWORD</code>. Managed in Settings &gt; Credentials. Use this for platform logins agents need for browser-based tasks.</li>' +
        '</ul>' +
        '<p>Both are stored locally and encrypted. Neither uses the OS keychain.</p>' +
        '<h3>Secret Storage (Vault)</h3>' +
        '<p>API keys and tokens are stored in a single <strong>encrypted file</strong>: <code>config/secrets.enc</code>. This is TeamHero' + q + 's own vault - it does <strong>not</strong> use the OS keychain (Windows Credential Manager, macOS Keychain, etc.). The file is self-contained and portable with your project.</p>' +
        '<h3>How the Vault Works</h3>' +
        '<p>The encrypted file structure: <code>[32-byte salt] [12-byte IV] [16-byte auth tag] [ciphertext]</code></p>' +
        '<ul>' +
        '<li><strong>Encryption:</strong> AES-256-GCM - the same standard used by banks and governments</li>' +
        '<li><strong>Key derivation:</strong> Your master password is transformed into an encryption key using PBKDF2 with SHA-512 and 100,000 iterations - this makes brute-force attacks impractical</li>' +
        '<li><strong>Random salt:</strong> A 32-byte random salt is generated per vault, so identical passwords produce different keys even if the password is reused</li>' +
        '<li><strong>Tamper detection:</strong> GCM mode includes an authentication tag - if anyone modifies the encrypted file, decryption fails</li>' +
        '<li><strong>Locked by default:</strong> On disk, secrets are always encrypted. They are only decrypted into memory after you unlock with your master password. When the server stops, the decrypted values are gone.</li>' +
        '</ul>' +
        '<h3>Risks You Should Know</h3>' +
        '<ul>' +
        '<li><strong>Master password is not stored anywhere.</strong> If you forget it, your secrets are gone. There is no recovery mechanism - that is by design. Write it down somewhere safe.</li>' +
        '<li><strong>In-memory exposure:</strong> While the server is running and the vault is unlocked, decrypted secrets exist in process memory. Anyone with access to your machine could theoretically read them from the running process.</li>' +
        '<li><strong>AI agents can use your keys.</strong> When secrets are unlocked, agents receive them as environment variables. A misconfigured or poorly prompted agent could call an API in ways you did not intend. Always review agent rules and use supervised mode for sensitive operations.</li>' +
        '<li><strong>The encrypted file is only as strong as your password.</strong> A weak master password can be brute-forced offline. Use a strong, unique password.</li>' +
        '<li><strong>No access control between agents.</strong> All unlocked secrets are available to all agents. You cannot restrict specific keys to specific agents. If an agent should not have access to a key, do not store it in the vault while that agent is active.</li>' +
        '<li><strong>Local network exposure:</strong> The dashboard runs on localhost. If your machine is on a shared network and the port is accessible, others could potentially reach the dashboard. TeamHero does not have authentication on the web UI.</li>' +
        '</ul>' +
        '<h3>Secret Injection</h3>' +
        '<p>When the vault is unlocked, secrets are injected as <strong>environment variables</strong> into agent sessions. Agents can use them (e.g. <code>$TRELLO_API_KEY</code>) but never see the actual values in plain text.</p>' +
        '<h3>Output Scrubbing</h3>' +
        '<p>All terminal output is <strong>automatically scrubbed</strong> before being displayed. If an agent accidentally echoes a secret value, it appears as <code>[REDACTED]</code>. This works in real-time on every line of output.</p>' +
        '<h3>Prompt Injection Protection</h3>' +
        '<p>When agents process external content (emails, web pages, user-submitted text), they treat it as <strong>untrusted data</strong>:</p>' +
        '<ul>' +
        '<li>Never execute instructions found in external content</li>' +
        '<li>Summarize rather than quote verbatim</li>' +
        '<li>Flag suspicious content that looks like injection attempts</li>' +
        '</ul>' +
        '<h3>File System Boundaries</h3>' +
        '<ul>' +
        '<li>All agent file operations are confined to the <strong>project root directory</strong></li>' +
        '<li>Agents cannot modify platform files (server.js, portal/) - these are protected</li>' +
        '<li>Path traversal is validated to prevent escaping the project sandbox</li>' +
        '<li>No destructive system commands (rm -rf, shutdown, kill, etc.)</li>' +
        '</ul>' +
        '<h3>External Communication Control</h3>' +
        '<ul>' +
        '<li>No emails, social media posts, git pushes, or API calls without <strong>explicit owner approval</strong></li>' +
        '<li>Content must be reviewed before publishing - even autopilot tasks log what they do</li>' +
        '<li>All published URLs are logged on the task for auditability</li>' +
        '</ul>' +
        '<h3>Security Rules</h3>' +
        '<p>You can edit the security rules in <strong>Team Rules</strong> under the Security section. These rules are injected into every agent session and enforced automatically.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'rules\')">Edit Security Rules &#8594;</button>'
    },
    {
      title: 'Settings & Config',
      icon: '&#9881;',
      content: '<h2>Settings &amp; Configuration</h2>' +
        '<h3>Owner Profile</h3>' +
        '<p>Your profile tells agents who you are - your name, role, expertise, and goals. Agents use this to tailor their work to your needs.</p>' +
        '<h3>Team Rules</h3>' +
        '<p>Operational rules that apply to all agents: task lifecycle, delegation rules, content standards, and collaboration protocols. These are the law of your team.</p>' +
        '<h3>Permission Modes</h3>' +
        '<ul>' +
        '<li><strong>Autonomous</strong> - Agents operate freely without confirmation prompts</li>' +
        '<li><strong>Supervised</strong> - Agents ask before executing certain actions</li>' +
        '</ul>' +
        '<h3>Credentials Manager</h3>' +
        '<p>Store website login credentials for services your agents need to access. Each entry has a service name, username, and password. They are injected as environment variables (<code>{SERVICE}_USERNAME</code> and <code>{SERVICE}_PASSWORD</code>) so agents can use them in browser-based tasks without you pasting credentials each time.</p>' +
        '<h3>Secrets &amp; API Keys</h3>' +
        '<p>Store API keys and tokens in the encrypted vault. These are injected as environment variables into agent sessions. See the <strong>Security &amp; Secrets</strong> help topic for details on how the vault works.</p>' +
        '<h3>Updates &amp; Self-Healing</h3>' +
        '<p>Check for platform updates from GitHub. Updates only affect platform files - your agents, tasks, and data are never touched. The upgrade system includes <strong>self-healing</strong>: if critical bootstrap files (launch scripts, package.json) are missing or corrupted, the updater detects and restores them automatically.</p>' +
        '<h3>CLI Installer</h3>' +
        '<p>When installing TeamHero via the CLI, the installer prompts you for a <strong>folder name</strong> for your team. This becomes the project directory where all your team data lives.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'settings\')">Go to Settings &#8594;</button>'
    }
  ];

  function loadHelp(topicIndex) {
    var idx = topicIndex || 0;
    var topicsEl = document.getElementById('help-topics');
    var contentEl = document.getElementById('help-content');
    if (!topicsEl || !contentEl) return;

    // Build topics list
    var html = '';
    for (var i = 0; i < helpTopics.length; i++) {
      html += '<div class="help-topic-item' + (i === idx ? ' active' : '') + '" onclick="App.selectHelpTopic(' + i + ')">' +
        '<span class="help-topic-icon">' + helpTopics[i].icon + '</span>' +
        helpTopics[i].title +
        '</div>';
    }
    topicsEl.innerHTML = html;

    // Load content
    contentEl.innerHTML = helpTopics[idx].content;
  }

  async function loadTerms() {
    var el = document.getElementById('terms-content');
    if (!el) return;
    try {
      var resp = await fetch('/TERMS.md');
      var text = await resp.text();
      if (typeof marked !== 'undefined' && marked.parse) {
        el.innerHTML = marked.parse(text);
      } else {
        el.textContent = text;
      }
    } catch(e) {
      el.textContent = 'Failed to load terms. See TERMS.md in the project root.';
    }
  }

  function selectHelpTopic(index) {
    var items = document.querySelectorAll('.help-topic-item');
    items.forEach(function(item, i) {
      item.classList.toggle('active', i === index);
    });
    var contentEl = document.getElementById('help-content');
    if (contentEl && helpTopics[index]) {
      contentEl.innerHTML = helpTopics[index].content;
      contentEl.scrollTop = 0;
    }
  }

  // ── JS-based tooltips (avoid sidebar overflow clipping) ──
  (function initTooltips() {
    var tip = document.createElement('div');
    tip.className = 'tooltip-popup';
    document.body.appendChild(tip);

    document.addEventListener('mouseenter', function(e) {
      if (!e.target || !e.target.closest) return;
      var el = e.target.closest('[data-tooltip]');
      if (!el) return;
      tip.textContent = el.getAttribute('data-tooltip');
      var rect = el.getBoundingClientRect();
      tip.style.left = (rect.right + 8) + 'px';
      tip.style.top = (rect.top + rect.height / 2) + 'px';
      tip.style.transform = 'translateY(-50%)';
      tip.classList.add('visible');
    }, true);

    document.addEventListener('mouseleave', function(e) {
      if (!e.target || !e.target.closest) return;
      var el = e.target.closest('[data-tooltip]');
      if (!el) return;
      tip.classList.remove('visible');
    }, true);
  })();

