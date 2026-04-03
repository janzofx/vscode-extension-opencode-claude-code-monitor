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
  SESSION_RETENTION_MS,
  prunePersistedState
} = loadTsModule(path.join('src', 'sessionRetention.ts'));

test('retention helper removes sessions older than one week and cascades related state', () => {
  const now = Date.now();
  const oldTimestamp = now - SESSION_RETENTION_MS - 1;
  const freshTimestamp = now - 60_000;

  const pruned = prunePersistedState({
    sessions: {
      old: {
        id: 'old',
        tool: 'claude-code',
        cwd: 'C:/Projects/Old',
        projectName: 'Old',
        status: 'idle',
        startedAt: oldTimestamp,
        lastActivityAt: oldTimestamp
      },
      fresh: {
        id: 'fresh',
        tool: 'codex',
        cwd: 'C:/Projects/Fresh',
        projectName: 'Fresh',
        status: 'idle',
        startedAt: freshTimestamp,
        lastActivityAt: freshTimestamp
      }
    },
    agents: {
      old: {
        id: 'old',
        sessionId: 'old',
        parentAgentId: null,
        agentType: 'Claude Code',
        status: 'completed',
        startedAt: oldTimestamp
      },
      fresh: {
        id: 'fresh',
        sessionId: 'fresh',
        parentAgentId: null,
        agentType: 'Codex',
        status: 'completed',
        startedAt: freshTimestamp
      }
    },
    delegations: {
      oldDelegation: {
        id: 'oldDelegation',
        sessionId: 'old',
        fromAgentId: 'old',
        toAgentId: 'pending',
        prompt: 'Old work',
        status: 'pending',
        createdAt: oldTimestamp
      },
      freshDelegation: {
        id: 'freshDelegation',
        sessionId: 'fresh',
        fromAgentId: 'fresh',
        toAgentId: 'pending',
        prompt: 'Fresh work',
        status: 'pending',
        createdAt: freshTimestamp
      }
    },
    fileEvents: [
      {
        sessionId: 'old',
        agentId: 'old',
        filePath: 'C:/Projects/Old/file.ts',
        operation: 'read',
        createdAt: oldTimestamp
      },
      {
        sessionId: 'fresh',
        agentId: 'fresh',
        filePath: 'C:/Projects/Fresh/file.ts',
        operation: 'read',
        createdAt: freshTimestamp
      }
    ]
  }, now);

  assert.deepEqual(Object.keys(pruned.sessions), ['fresh']);
  assert.deepEqual(Object.keys(pruned.agents), ['fresh']);
  assert.deepEqual(Object.keys(pruned.delegations), ['freshDelegation']);
  assert.deepEqual(pruned.fileEvents.map(event => event.sessionId), ['fresh']);
});

test.after(() => {
  if (originalTsExtension) {
    Module._extensions['.ts'] = originalTsExtension;
  } else {
    delete Module._extensions['.ts'];
  }
});
