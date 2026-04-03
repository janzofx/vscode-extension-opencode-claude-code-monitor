const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

const {
  getVisibleSessionsForFleet
} = loadTsModule(path.join('src', 'sessionVisibility.ts'));

test('fleet hides inactive no-op sessions once they are no longer active', () => {
  const now = Date.now();
  const sessions = {
    'session-empty': {
      id: 'session-empty',
      tool: 'claude-code',
      cwd: 'C:/Projects/Test',
      projectName: 'Test',
      status: 'idle',
      startedAt: now - 60_000,
      lastActivityAt: now - 10_000
    }
  };

  const visible = getVisibleSessionsForFleet({
    sessions,
    fileEvents: [],
    delegations: {},
    now
  });

  assert.deepEqual(visible.map(session => session.id), []);
});

test('fleet hides sessions older than the recent retention window', () => {
  const now = Date.now();
  const sessions = {
    'session-old': {
      id: 'session-old',
      tool: 'codex',
      cwd: 'C:/Projects/Old',
      projectName: 'Old',
      status: 'idle',
      startedAt: now - (8 * 24 * 60 * 60 * 1000),
      lastActivityAt: now - (8 * 24 * 60 * 60 * 1000)
    },
    'session-recent': {
      id: 'session-recent',
      tool: 'codex',
      cwd: 'C:/Projects/Recent',
      projectName: 'Recent',
      status: 'idle',
      startedAt: now - (2 * 60 * 60 * 1000),
      lastActivityAt: now - (2 * 60 * 60 * 1000)
    }
  };

  const visible = getVisibleSessionsForFleet({
    sessions,
    fileEvents: [
      {
        sessionId: 'session-old',
        agentId: 'session-old',
        filePath: 'C:/Projects/Old/file.ts',
        operation: 'read',
        createdAt: now - (8 * 24 * 60 * 60 * 1000)
      },
      {
        sessionId: 'session-recent',
        agentId: 'session-recent',
        filePath: 'C:/Projects/Recent/file.ts',
        operation: 'read',
        createdAt: now - (2 * 60 * 60 * 1000)
      }
    ],
    delegations: {},
    now
  });

  assert.deepEqual(visible.map(session => session.id), ['session-recent']);
});

test('fleet keeps active sessions visible even before any tool work is recorded', () => {
  const now = Date.now();
  const sessions = {
    'session-active': {
      id: 'session-active',
      tool: 'claude-code',
      cwd: 'C:/Projects/Test',
      projectName: 'Test',
      status: 'active',
      startedAt: now - 30_000,
      lastActivityAt: now - 5_000
    }
  };

  const visible = getVisibleSessionsForFleet({
    sessions,
    fileEvents: [],
    delegations: {},
    now
  });

  assert.deepEqual(visible.map(session => session.id), ['session-active']);
});

test.after(() => {
  if (originalTsExtension) {
    Module._extensions['.ts'] = originalTsExtension;
  } else {
    delete Module._extensions['.ts'];
  }
});
