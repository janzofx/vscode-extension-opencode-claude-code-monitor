const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function loadTsModule(relativePath) {
  const sourcePath = path.join(__dirname, '..', relativePath);
  const sourceText = fs.readFileSync(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    },
    fileName: sourcePath
  });

  const loaded = new Module(sourcePath, module);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  loaded._compile(transpiled.outputText, sourcePath);
  return loaded.exports;
}

const { OpenCodeParser } = loadTsModule(path.join('src', 'parsers', 'opencode.ts'));
const { CodexParser } = loadTsModule(path.join('src', 'parsers', 'codex.ts'));

test('OpenCode currentTask falls back to the latest real tool when no tool is still running', () => {
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

test('OpenCode currentTask for task tool describes delegation work instead of the delegated prompt', () => {
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

  assert.equal(parsed.agents['session-1'].currentTask, 'task: delegating work');
});

test('OpenCode currentTask becomes Task started when a new turn begins without a newer tool yet', () => {
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
        id: 'msg-1',
        sessionId: 'session-1',
        timeCreated: now - 900,
        timeUpdated: now - 900,
        data: JSON.stringify({ agent: 'build', modelID: 'model', providerID: 'opencode' })
      }
    ],
    parts: [
      {
        id: 'part-tool',
        messageId: 'msg-1',
        sessionId: 'session-1',
        timeCreated: now - 800,
        timeUpdated: now - 700,
        data: JSON.stringify({
          type: 'tool',
          tool: 'read',
          state: {
            status: 'completed',
            input: {
              filePath: 'C:/Projects/Test/older-file.ts'
            }
          }
        })
      },
      {
        id: 'part-step',
        messageId: 'msg-1',
        sessionId: 'session-1',
        timeCreated: now - 100,
        timeUpdated: now - 100,
        data: JSON.stringify({
          type: 'step-start'
        })
      }
    ]
  };

  const parsed = OpenCodeParser.parseDatabase(snapshot);

  assert.equal(parsed.agents['session-1'].currentTask, 'Task started');
});

test('OpenCode currentTask still prefers the latest real tool when it is newer than step markers', () => {
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
        id: 'msg-1',
        sessionId: 'session-1',
        timeCreated: now - 900,
        timeUpdated: now - 900,
        data: JSON.stringify({ agent: 'build', modelID: 'model', providerID: 'opencode' })
      }
    ],
    parts: [
      {
        id: 'part-step',
        messageId: 'msg-1',
        sessionId: 'session-1',
        timeCreated: now - 200,
        timeUpdated: now - 200,
        data: JSON.stringify({
          type: 'step-start'
        })
      },
      {
        id: 'part-tool',
        messageId: 'msg-1',
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

  assert.equal(parsed.agents['session-1'].currentTask, 'edit: C:/Projects/Test/newer-file.ts');
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

test('Codex currentTask prefers the latest function call instead of assistant prose', async () => {
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

  assert.equal(parsed.agents['codex-session-1'].currentTask, 'shell_command: npm test');
});
