// Enforce i18n key parity across apps/web/messages/*.json.
//
// CLAUDE.md (sections 12.5, 13) treats English-only UI strings as a lint
// failure, but until this script no tool actually enforced it: parity was
// held by manual discipline alone. This runs inside `pnpm lint`, so a key
// present in one locale but missing from another now fails the lint gate.
//
// English (en.json) is the reference. Every other locale file in the
// directory must carry exactly the same set of leaf keys: no missing keys
// (untranslated strings) and no extra keys (stale entries).
import { readdirSync, readFileSync } from 'node:fs';

const messagesDir = new URL('../apps/web/messages/', import.meta.url);
const referenceLocale = 'en';
const referenceFile = `${referenceLocale}.json`;

/** Flatten a nested messages object to dotted leaf-key paths. */
function flattenKeys(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) =>
    child !== null && typeof child === 'object' && !Array.isArray(child)
      ? flattenKeys(child, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

function loadKeys(fileName) {
  const raw = readFileSync(new URL(fileName, messagesDir), 'utf8');
  return new Set(flattenKeys(JSON.parse(raw)));
}

const localeFiles = readdirSync(messagesDir).filter((name) => name.endsWith('.json'));

if (!localeFiles.includes(referenceFile)) {
  console.error(`i18n parity: reference locale ${referenceFile} not found in apps/web/messages/`);
  process.exit(1);
}

const referenceKeys = loadKeys(referenceFile);
const failures = [];

for (const fileName of localeFiles) {
  if (fileName === referenceFile) {
    continue;
  }
  const localeKeys = loadKeys(fileName);
  const missing = [...referenceKeys].filter((key) => !localeKeys.has(key)).sort();
  const extra = [...localeKeys].filter((key) => !referenceKeys.has(key)).sort();
  if (missing.length > 0 || extra.length > 0) {
    failures.push({ fileName, missing, extra });
  }
}

if (failures.length === 0) {
  const locales = localeFiles.map((name) => name.replace('.json', '')).join(', ');
  console.log(`i18n parity: OK (${referenceKeys.size} keys, locales: ${locales})`);
  process.exit(0);
}

console.error('i18n parity: FAILED. Every locale must match the reference (en.json).');
for (const { fileName, missing, extra } of failures) {
  if (missing.length > 0) {
    console.error(
      `\n  ${fileName} is MISSING ${missing.length} key(s) present in ${referenceFile}:`,
    );
    for (const key of missing) {
      console.error(`    - ${key}`);
    }
  }
  if (extra.length > 0) {
    console.error(`\n  ${fileName} has ${extra.length} EXTRA key(s) not in ${referenceFile}:`);
    for (const key of extra) {
      console.error(`    + ${key}`);
    }
  }
}
console.error('');
process.exit(1);
