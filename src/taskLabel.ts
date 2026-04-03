const LEADING_VERB_LABELS: Record<string, string> = {
  add: 'Adding',
  analyze: 'Analyzing',
  analyse: 'Analysing',
  audit: 'Auditing',
  build: 'Building',
  check: 'Checking',
  clean: 'Cleaning',
  compare: 'Comparing',
  create: 'Creating',
  debug: 'Debugging',
  document: 'Documenting',
  edit: 'Editing',
  find: 'Finding',
  fix: 'Fixing',
  generate: 'Generating',
  implement: 'Implementing',
  improve: 'Improving',
  inspect: 'Inspecting',
  investigate: 'Investigating',
  migrate: 'Migrating',
  move: 'Moving',
  optimize: 'Optimizing',
  optimise: 'Optimising',
  plan: 'Planning',
  rename: 'Renaming',
  run: 'Running',
  read: 'Reading',
  refactor: 'Refactoring',
  refine: 'Refining',
  remove: 'Removing',
  review: 'Reviewing',
  search: 'Searching',
  summarize: 'Summarizing',
  summarise: 'Summarising',
  sync: 'Syncing',
  test: 'Testing',
  update: 'Updating',
  verify: 'Verifying',
  write: 'Writing'
};

const ACKNOWLEDGEMENT_PREFIXES = [
  /^yes(?:\s+please)?[,:\-\s]*/i,
  /^ok(?:ay)?[,:\-\s]*/i,
  /^sure[,:\-\s]*/i,
  /^sounds good[,:\-\s]*/i,
  /^thanks?(?:\s+you)?[,:\-\s]*/i
];

const INSTRUCTION_WRAPPERS = [
  /^please\s+/i,
  /^(?:can|could|would|will)\s+you\s+/i,
  /^help\s+me\s+/i,
  /^(?:i|we)\s+need\s+you\s+to\s+/i,
  /^(?:i|we)\s+want\s+you\s+to\s+/i,
  /^let'?s\s+/i,
  /^let\s+us\s+/i
];

const WEAK_FOLLOW_UP_PATTERNS = [
  /^(?:i|we)\s+(?:want|need|would\s+like)\s+(?:it|this|that|them|these|those)\s+to\b/i,
  /^(?:it|this|that|they|them|these|those)\s+(?:should|need(?:s)?|must|has\s+to|have\s+to)\b/i,
  /^(?:make|do|fix|handle|support|apply|work)\s+(?:it|this|that|them|these|those)\b/i
];

export function formatStableTaskLabel(prompt: string | undefined): string | undefined {
  const normalized = normalizeInputText(prompt);
  if (!normalized) {
    return undefined;
  }

  const withoutAcknowledgement = stripByPatterns(normalized, ACKNOWLEDGEMENT_PREFIXES);
  if (!withoutAcknowledgement) {
    return undefined;
  }

  if (isWeakFollowUpPrompt(withoutAcknowledgement)) {
    return undefined;
  }

  const commandText = stripByPatterns(withoutAcknowledgement, INSTRUCTION_WRAPPERS);
  const scoped = normalizeWorkspaceScope(commandText);
  if (!scoped) {
    return undefined;
  }

  const match = scoped.match(/^([A-Za-z]+)(\b.*)$/);
  if (!match) {
    return `Working on ${lowercaseFirst(scoped)}`;
  }

  const verb = match[1].toLowerCase();
  const labelPrefix = LEADING_VERB_LABELS[verb];
  if (!labelPrefix) {
    return `Working on ${lowercaseFirst(scoped)}`;
  }

  return `${labelPrefix}${humanizeVerbRemainder(verb, match[2] || '')}`;
}

export function deriveStatusLabelFromAssistantMessage(message: string | undefined): string | undefined {
  const normalized = normalizeInputText(message);
  if (!normalized) {
    return undefined;
  }

  const rawClause = trimAssistantStatusClause(normalized);
  if (/^[A-Za-z]+ing\b/.test(rawClause)) {
    return capitalizeSentence(normalizeWorkspaceScope(rawClause));
  }

  const workingOnMatch = rawClause.match(/^working on\s+(.+)$/i);
  if (workingOnMatch?.[1]) {
    const scoped = normalizeWorkspaceScope(workingOnMatch[1]);
    return `Working on ${lowercaseFirst(scoped)}`;
  }

  const presentProgressMatch = normalized.match(/^(?:i['’]?m|i am)\s+(.+)$/i);
  if (presentProgressMatch?.[1]) {
    return deriveStatusLabelFromAssistantProgressBody(presentProgressMatch[1]);
  }

  const futureActionMatch = normalized.match(/^(?:i['’]?ll|i will|let me|currently|now)\s+(.+)$/i);
  if (futureActionMatch?.[1]) {
    return deriveStatusLabelFromAssistantProgressBody(futureActionMatch[1]);
  }

  return undefined;
}

export function extractTextContent(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized || undefined;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map(item => extractTextContent(item))
      .filter((item): item is string => Boolean(item));

    return parts.length > 0 ? parts.join(' ') : undefined;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const directKeys = ['text', 'input', 'message'];
  for (const key of directKeys) {
    const extracted = extractTextContent(record[key]);
    if (extracted) {
      return extracted;
    }
  }

  const nestedKeys = ['content', 'parts', 'prompt'];
  for (const key of nestedKeys) {
    const extracted = extractTextContent(record[key]);
    if (extracted) {
      return extracted;
    }
  }

  return undefined;
}

function normalizeInputText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.!?]+$/g, '');

  return normalized || undefined;
}

function stripByPatterns(value: string, patterns: RegExp[]): string {
  let stripped = value;
  for (const pattern of patterns) {
    stripped = stripped.replace(pattern, '');
  }
  return stripped.trim();
}

function isWeakFollowUpPrompt(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (WEAK_FOLLOW_UP_PATTERNS.some(pattern => pattern.test(normalized))) {
    return true;
  }

  const words = normalized.split(/\s+/);
  if (words.length <= 2 && ['yes', 'ok', 'okay', 'sure', 'please'].includes(words[0])) {
    return true;
  }

  return false;
}

function normalizeWorkspaceScope(value: string): string {
  return value
    .replace(/\bfor\s+(?:the\s+)?(?:full|whole|entire)\s+repo\b/gi, 'for the entire repository')
    .replace(/\bfor\s+(?:the\s+)?(?:full|whole|entire)\s+repository\b/gi, 'for the entire repository')
    .replace(/\bfor\s+(?:the\s+)?(?:full|whole|entire)\s+codebase\b/gi, 'for the entire codebase')
    .replace(/\bfor\s+repo\b/gi, 'for the repository')
    .replace(/\bfor\s+repository\b/gi, 'for the repository')
    .replace(/\bfor\s+codebase\b/gi, 'for the codebase')
    .replace(/\bfull repo\b/gi, 'the entire repository')
    .replace(/\bfull repository\b/gi, 'the entire repository')
    .replace(/\bfull codebase\b/gi, 'the entire codebase')
    .replace(/\brepo\b/gi, 'repository');
}

function trimAssistantStatusClause(value: string): string {
  const sentence = value.split(/[.!?]/, 1)[0]?.trim() || value.trim();
  const connectorMatch = sentence.match(/^(.*?)(?:\s+(?:so|because|while|but|since)\s+.*)$/i);
  return connectorMatch?.[1]?.trim() || sentence;
}

function deriveStatusLabelFromAssistantProgressBody(value: string): string | undefined {
  const trimmed = trimAssistantStatusClause(value);
  if (!trimmed) {
    return undefined;
  }

  const goingToMatch = trimmed.match(/^going to\s+(.+)$/i);
  if (goingToMatch?.[1]) {
    return formatStableTaskLabel(goingToMatch[1]);
  }

  if (/^[A-Za-z]+ing\b/.test(trimmed)) {
    return capitalizeSentence(normalizeWorkspaceScope(trimmed));
  }

  return formatStableTaskLabel(trimmed);
}

function humanizeVerbRemainder(verb: string, remainder: string): string {
  const trimmed = remainder.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    return '';
  }

  if (verb === 'run') {
    const repositoryScoped = trimmed.match(/^(.*)\s+for\s+the\s+entire\s+(repository|codebase)$/i);
    if (repositoryScoped) {
      const activity = repositoryScoped[1].trim();
      const scope = repositoryScoped[2].toLowerCase();
      if (!/^(full|complete|entire)\b/i.test(activity)) {
        return ` full ${activity} for the entire ${scope}`;
      }
    }
  }

  return ` ${trimmed}`;
}

function capitalizeSentence(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function lowercaseFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
