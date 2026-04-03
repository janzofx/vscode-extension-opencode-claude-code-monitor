const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const originalTsExtension = Module._extensions['.ts'];
Module._extensions['.ts'] = function compileTs(module, filename) {
  const sourceText = fs.readFileSync(filename, 'utf8');
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    },
    fileName: filename
  });

  module._compile(transpiled.outputText, filename);
};

function loadTsModule(relativePath) {
  const sourcePath = path.join(__dirname, '..', relativePath);
  delete require.cache[sourcePath];
  return require(sourcePath);
}

const { OpenCodeParser } = loadTsModule(path.join('src', 'parsers', 'opencode.ts'));
const { CodexParser } = loadTsModule(path.join('src', 'parsers', 'codex.ts'));
const {
  formatStableTaskLabel,
  deriveStatusLabelFromAssistantMessage
} = loadTsModule(path.join('src', 'taskLabel.ts'));

test('task labels humanize repo-wide prompts into natural status text', () => {
  assert.equal(
    formatStableTaskLabel('Run security audit for full repo'),
    'Running full security audit for the entire repository'
  );
});

test('task labels rewrite common prompt wrappers into natural action labels', () => {
  assert.equal(
    formatStableTaskLabel('Can you review auth flow?'),
    'Reviewing auth flow'
  );
  assert.equal(
    formatStableTaskLabel('Please create README for repo'),
    'Creating README for the repository'
  );
  assert.equal(
    formatStableTaskLabel('Help me debug failing tests'),
    'Debugging failing tests'
  );
  assert.equal(
    formatStableTaskLabel('I need you to rename the config files'),
    'Renaming the config files'
  );
  assert.equal(
    formatStableTaskLabel('security audit for repo'),
    'Working on security audit for the repository'
  );
  assert.equal(
    formatStableTaskLabel('yes please, I want it to work on all prompts'),
    undefined
  );
});

test('assistant progress messages become stable status labels', () => {
  assert.equal(
    deriveStatusLabelFromAssistantMessage("I'm improving current task label formatting so it works across prompts."),
    'Improving current task label formatting'
  );
});

test('OpenCode main currentTask prefers assistant progress when the latest user follow-up is weak', () => {
  const snapshot = {
    projects: [
      { id: 'proj-1', worktree: 'C:/Projects/Test', name: 'Test Project', timeUpdated: 10 }
    ],
    sessions: [
      {
        id: 'session-weak-followup',
        projectId: 'proj-1',
        parentId: null,
        directory: 'C:/Projects/Test',
        title: 'Main session',
        timeCreated: 1,
        timeUpdated: 20,
        version: '1'
      }
    ],
    messages: [
      {
        id: 'msg-user',
        sessionId: 'session-weak-followup',
        timeCreated: 2,
        timeUpdated: 2,
        data: JSON.stringify({ role: 'user', modelID: 'model', providerID: 'opencode' })
      },
      {
        id: 'msg-assistant',
        sessionId: 'session-weak-followup',
        timeCreated: 3,
        timeUpdated: 3,
        data: JSON.stringify({ role: 'assistant', agent: 'build', modelID: 'model', providerID: 'opencode' })
      }
    ],
    parts: [
      {
        id: 'part-user',
        messageId: 'msg-user',
        sessionId: 'session-weak-followup',
        timeCreated: 2,
        timeUpdated: 2,
        data: JSON.stringify({
          type: 'text',
          text: 'yes please, I want it to work on all prompts'
        })
      },
      {
        id: 'part-assistant',
        messageId: 'msg-assistant',
        sessionId: 'session-weak-followup',
        timeCreated: 4,
        timeUpdated: 4,
        data: JSON.stringify({
          type: 'text',
          text: "I'm improving current task label formatting so it works across prompts."
        })
      }
    ]
  };

  const parsed = OpenCodeParser.parseDatabase(snapshot);

  assert.equal(
    parsed.agents['session-weak-followup'].currentTask,
    'Improving current task label formatting'
  );
});

test('OpenCode main currentTask uses the latest user prompt instead of tool churn', () => {
  const snapshot = {
    projects: [
      { id: 'proj-1', worktree: 'C:/Projects/Test', name: 'Test Project', timeUpdated: 10 }
    ],
    sessions: [
      {
        id: 'session-1',
        projectId: 'proj-1',
        parentId: null,
        directory: 'C:/Projects/Test',
        title: 'Main session',
        timeCreated: 1,
        timeUpdated: 20,
        version: '1'
      }
    ],
    messages: [
      {
        id: 'msg-user',
        sessionId: 'session-1',
        timeCreated: 2,
        timeUpdated: 2,
        data: JSON.stringify({ role: 'user', modelID: 'model', providerID: 'opencode' })
      },
      {
        id: 'msg-assistant',
        sessionId: 'session-1',
        timeCreated: 5,
        timeUpdated: 5,
        data: JSON.stringify({ role: 'assistant', agent: 'build', modelID: 'model', providerID: 'opencode' })
      }
    ],
    parts: [
      {
        id: 'part-user',
        messageId: 'msg-user',
        sessionId: 'session-1',
        timeCreated: 3,
        timeUpdated: 3,
        data: JSON.stringify({
          type: 'text',
          text: 'update all docs in the codebase'
        })
      },
      {
        id: 'part-1',
        messageId: 'msg-assistant',
        sessionId: 'session-1',
        timeCreated: 6,
        timeUpdated: 4,
        data: JSON.stringify({
          type: 'tool',
          tool: 'read',
          state: {
            status: 'completed',
            input: {
              filePath: 'C:/Projects/Test/opencode.json'
            }
          }
        })
      }
    ]
  };

  const parsed = OpenCodeParser.parseDatabase(snapshot);

  assert.equal(
    parsed.agents['session-1'].currentTask,
    'Updating all docs in the codebase'
  );
});

test('OpenCode subagent currentTask uses the delegation prompt', () => {
  const snapshot = {
    projects: [
      { id: 'proj-1', worktree: 'C:/Projects/Test', name: 'Test Project', timeUpdated: 10 }
    ],
    sessions: [
      {
        id: 'session-1',
        projectId: 'proj-1',
        parentId: null,
        directory: 'C:/Projects/Test',
        title: 'Main session',
        timeCreated: 1,
        timeUpdated: 20,
        version: '1'
      },
      {
        id: 'session-2',
        projectId: 'proj-1',
        parentId: 'session-1',
        directory: 'C:/Projects/Test',
        title: '',
        timeCreated: 4,
        timeUpdated: 20,
        version: '1'
      }
    ],
    messages: [
      {
        id: 'msg-1',
        sessionId: 'session-1',
        timeCreated: 2,
        timeUpdated: 2,
        data: JSON.stringify({ agent: 'build', modelID: 'model', providerID: 'opencode' })
      }
    ],
    parts: [
      {
        id: 'part-1',
        messageId: 'msg-1',
        sessionId: 'session-1',
        timeCreated: 3,
        timeUpdated: 4,
        data: JSON.stringify({
          type: 'tool',
          tool: 'task',
          state: {
            status: 'completed',
            input: {
              description: 'Write migration tests'
            }
          }
        })
      }
    ]
  };

  const parsed = OpenCodeParser.parseDatabase(snapshot);

  assert.equal(parsed.agents['session-2'].currentTask, 'Writing migration tests');
});

test('OpenCode currentTask falls back to the latest real tool when no prompt text is available', () => {
  const snapshot = {
    projects: [
      { id: 'proj-1', worktree: 'C:/Projects/Test', name: 'Test Project', timeUpdated: 10 }
    ],
    sessions: [
      {
        id: 'session-1',
        projectId: 'proj-1',
        parentId: null,
        directory: 'C:/Projects/Test',
        title: 'Main session',
        timeCreated: 1,
        timeUpdated: 20,
        timeArchived: null
      }
    ],
    messages: [
      {
        id: 'msg-1',
        sessionId: 'session-1',
        timeCreated: 2,
        timeUpdated: 2,
        data: JSON.stringify({ agent: 'build', modelID: 'model', providerID: 'opencode' })
      }
    ],
    parts: [
      {
        id: 'part-1',
        messageId: 'msg-1',
        sessionId: 'session-1',
        timeCreated: 3,
        timeUpdated: 4,
        data: JSON.stringify({
          type: 'tool',
          tool: 'read',
          state: {
            status: 'completed',
            input: {
              filePath: 'C:/Projects/Test/opencode.json'
            }
          }
        })
      }
    ]
  };

  const parsed = OpenCodeParser.parseDatabase(snapshot);

  assert.equal(
    parsed.agents['session-1'].currentTask,
    'read: C:/Projects/Test/opencode.json'
  );
});

test('OpenCode main currentTask uses the most recent user prompt when a new turn begins', () => {
  const now = Date.now();
  const snapshot = {
    projects: [
      { id: 'proj-1', worktree: 'C:/Projects/Test', name: 'Test Project', timeUpdated: now }
    ],
    sessions: [
      {
        id: 'session-1',
        projectId: 'proj-1',
        parentId: null,
        directory: 'C:/Projects/Test',
        title: 'Main session',
        timeCreated: now - 1000,
        timeUpdated: now,
        timeArchived: null
      }
    ],
    messages: [
      {
        id: 'msg-old',
        sessionId: 'session-1',
        timeCreated: now - 900,
        timeUpdated: now - 900,
        data: JSON.stringify({ role: 'user', modelID: 'model', providerID: 'opencode' })
      },
      {
        id: 'msg-new',
        sessionId: 'session-1',
        timeCreated: now - 200,
        timeUpdated: now - 200,
        data: JSON.stringify({ role: 'user', modelID: 'model', providerID: 'opencode' })
      }
    ],
    parts: [
      {
        id: 'part-old',
        messageId: 'msg-old',
        sessionId: 'session-1',
        timeCreated: now - 850,
        timeUpdated: now - 850,
        data: JSON.stringify({
          type: 'text',
          text: 'review auth flow'
        })
      },
      {
        id: 'part-new',
        messageId: 'msg-new',
        sessionId: 'session-1',
        timeCreated: now - 150,
        timeUpdated: now - 150,
        data: JSON.stringify({
          type: 'text',
          text: 'fix the task label behavior'
        })
      },
      {
        id: 'part-tool',
        messageId: 'msg-new',
        sessionId: 'session-1',
        timeCreated: now - 100,
        timeUpdated: now - 50,
        data: JSON.stringify({
          type: 'tool',
          tool: 'edit',
          state: {
            status: 'completed',
            input: {
              filePath: 'C:/Projects/Test/newer-file.ts'
            }
          }
        })
      }
    ]
  };

  const parsed = OpenCodeParser.parseDatabase(snapshot);

  assert.equal(parsed.agents['session-1'].currentTask, 'Fixing the task label behavior');
});

test('OpenCode keeps a fresh unarchived session active after a step-finish stop', () => {
  const now = Date.now();
  const snapshot = {
    projects: [
      { id: 'proj-1', worktree: 'C:/Projects/Test', name: 'Test Project', timeUpdated: now }
    ],
    sessions: [
      {
        id: 'session-1',
        projectId: 'proj-1',
        parentId: null,
        directory: 'C:/Projects/Test',
        title: 'Main session',
        timeCreated: now - 2000,
        timeUpdated: now - 50,
        timeArchived: null
      }
    ],
    messages: [
      {
        id: 'msg-1',
        sessionId: 'session-1',
        timeCreated: now - 200,
        timeUpdated: now - 50,
        data: JSON.stringify({ agent: 'build', modelID: 'model', providerID: 'opencode' })
      }
    ],
    parts: [
      {
        id: 'part-stop',
        messageId: 'msg-1',
        sessionId: 'session-1',
        timeCreated: now - 100,
        timeUpdated: now - 100,
        data: JSON.stringify({
          type: 'step-finish',
          reason: 'stop'
        })
      }
    ]
  };

  const parsed = OpenCodeParser.parseDatabase(snapshot);

  assert.equal(parsed.sessions['session-1'].status, 'active');
  assert.equal(parsed.agents['session-1'].status, 'active');
});

test('OpenCode marks archived sessions as completed', () => {
  const now = Date.now();
  const snapshot = {
    projects: [
      { id: 'proj-1', worktree: 'C:/Projects/Test', name: 'Test Project', timeUpdated: now }
    ],
    sessions: [
      {
        id: 'session-1',
        projectId: 'proj-1',
        parentId: null,
        directory: 'C:/Projects/Test',
        title: 'Main session',
        timeCreated: now - 5000,
        timeUpdated: now - 100,
        timeArchived: now - 50
      }
    ],
    messages: [
      {
        id: 'msg-1',
        sessionId: 'session-1',
        timeCreated: now - 1000,
        timeUpdated: now - 100,
        data: JSON.stringify({ agent: 'build', modelID: 'model', providerID: 'opencode' })
      }
    ],
    parts: []
  };

  const parsed = OpenCodeParser.parseDatabase(snapshot);

  assert.equal(parsed.sessions['session-1'].status, 'completed');
  assert.equal(parsed.agents['session-1'].status, 'completed');
});

test('OpenCode marks stale unarchived sessions as idle', () => {
  const now = Date.now();
  const staleTime = now - (2 * 60 * 60 * 1000);
  const snapshot = {
    projects: [
      { id: 'proj-1', worktree: 'C:/Projects/Test', name: 'Test Project', timeUpdated: staleTime }
    ],
    sessions: [
      {
        id: 'session-1',
        projectId: 'proj-1',
        parentId: null,
        directory: 'C:/Projects/Test',
        title: 'Main session',
        timeCreated: staleTime,
        timeUpdated: staleTime,
        timeArchived: null
      }
    ],
    messages: [
      {
        id: 'msg-1',
        sessionId: 'session-1',
        timeCreated: staleTime,
        timeUpdated: staleTime,
        data: JSON.stringify({ agent: 'build', modelID: 'model', providerID: 'opencode' })
      }
    ],
    parts: [
      {
        id: 'part-stop',
        messageId: 'msg-1',
        sessionId: 'session-1',
        timeCreated: staleTime,
        timeUpdated: staleTime,
        data: JSON.stringify({
          type: 'step-finish',
          reason: 'stop'
        })
      }
    ]
  };

  const parsed = OpenCodeParser.parseDatabase(snapshot);

  assert.equal(parsed.sessions['session-1'].status, 'idle');
  assert.equal(parsed.agents['session-1'].status, 'completed');
});

test('Codex currentTask prefers the latest user prompt instead of function calls', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-parser-test-'));
  const sessionPath = path.join(tempDir, 'session.jsonl');
  const lines = [
    {
      timestamp: '2026-03-29T18:37:05.000Z',
      type: 'session_meta',
      payload: {
        id: 'codex-session-1',
        cwd: 'C:/Projects/Test',
        model: 'gpt-5.4'
      }
    },
    {
      timestamp: '2026-03-29T18:37:08.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'update all docs in the codebase'
          }
        ]
      }
    },
    {
      timestamp: '2026-03-29T18:37:10.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'shell_command',
        arguments: JSON.stringify({ command: 'npm test' })
      }
    },
    {
      timestamp: '2026-03-29T18:37:11.000Z',
      type: 'event_msg',
      payload: {
        type: 'agent_message',
        message: 'I am now checking the logs and this should not become the current task.'
      }
    },
    {
      timestamp: '2026-03-29T18:37:12.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: 'This is assistant prose and should not be used as the current task.'
          }
        ]
      }
    }
  ];

  fs.writeFileSync(sessionPath, lines.map(line => JSON.stringify(line)).join('\n'));

  const parsed = await CodexParser.parseSessionFile(sessionPath, false);

  assert.equal(parsed.agents['codex-session-1'].currentTask, 'Updating all docs in the codebase');
});

test('Codex currentTask switches to live tool activity after task_started', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-parser-test-'));
  const sessionPath = path.join(tempDir, 'session-live-tool.jsonl');
  const lines = [
    {
      timestamp: '2026-03-29T18:37:05.000Z',
      type: 'session_meta',
      payload: {
        id: 'codex-session-live-tool',
        cwd: 'C:/Projects/Test',
        model: 'gpt-5.4'
      }
    },
    {
      timestamp: '2026-03-29T18:37:08.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'fix the task label behavior'
          }
        ]
      }
    },
    {
      timestamp: '2026-03-29T18:37:09.000Z',
      type: 'event_msg',
      payload: {
        type: 'task_started'
      }
    },
    {
      timestamp: '2026-03-29T18:37:10.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'shell_command',
        arguments: JSON.stringify({ command: 'npm test' })
      }
    }
  ];

  fs.writeFileSync(sessionPath, lines.map(line => JSON.stringify(line)).join('\n'));

  const parsed = await CodexParser.parseSessionFile(sessionPath, false);

  assert.equal(parsed.agents['codex-session-live-tool'].currentTask, 'shell_command: npm test');
});

test('Codex currentTask falls back to the latest function call when no user prompt exists', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-parser-test-'));
  const sessionPath = path.join(tempDir, 'session-no-user.jsonl');
  const lines = [
    {
      timestamp: '2026-03-29T18:37:05.000Z',
      type: 'session_meta',
      payload: {
        id: 'codex-session-2',
        cwd: 'C:/Projects/Test',
        model: 'gpt-5.4'
      }
    },
    {
      timestamp: '2026-03-29T18:37:10.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'shell_command',
        arguments: JSON.stringify({ command: 'npm test' })
      }
    }
  ];

  fs.writeFileSync(sessionPath, lines.map(line => JSON.stringify(line)).join('\n'));

  const parsed = await CodexParser.parseSessionFile(sessionPath, false);

  assert.equal(parsed.agents['codex-session-2'].currentTask, 'shell_command: npm test');
});

test.after(() => {
  if (originalTsExtension) {
    Module._extensions['.ts'] = originalTsExtension;
  } else {
    delete Module._extensions['.ts'];
  }
});
