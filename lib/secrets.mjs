// Secret detection used by the pre-commit hook. It reports WHAT matched and WHERE, never the secret itself.

const PATTERNS = [
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai-style-key', /\bsk-[A-Za-z0-9]{32,}\b/],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/],
  ['github-fine-grained-token', /\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['private-key-block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['hardcoded-credential', /\b(?:api[_-]?key|secret|token|passwd|password)\b\s*[:=]\s*['"][A-Za-z0-9/+_-]{20,}['"]/i],
];

const BLOCKED_FILES = [
  /(^|\/)\.env(\..+)?$/,
  /\.(?:pem|p12|pfx|jks|keystore)$/,
  /(^|\/)id_(?:rsa|ed25519|ecdsa)$/,
];
const ALLOWED_FILES = [/(^|\/)\.env\.example$/];

const ALLOW_MARKER = 'factory:allow-secret';

export function blockedFile(path) {
  return !ALLOWED_FILES.some((r) => r.test(path)) && BLOCKED_FILES.some((r) => r.test(path));
}

// `honorAllowMarker: false` ignores the factory:allow-secret opt-out (used when text is copied into reports).
export function scanText(text, { honorAllowMarker = true } = {}) {
  const findings = [];
  text.split('\n').forEach((line, i) => {
    if (honorAllowMarker && line.includes(ALLOW_MARKER)) return;
    for (const [name, re] of PATTERNS) if (re.test(line)) findings.push({ line: i + 1, pattern: name });
  });
  return findings;
}

// Parses `git diff --cached -U0` and scans only the added lines, keeping the file name for reporting.
export function scanDiff(diff) {
  const findings = [];
  let file = '?';
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) { file = raw.slice(6); continue; }
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    for (const f of scanText(raw.slice(1))) findings.push({ file, pattern: f.pattern });
  }
  return findings;
}
