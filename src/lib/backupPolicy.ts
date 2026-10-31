import policy from '../../desktop/backup-policy.json';

// JSON policy is shared with Electron; no Node or CommonJS imports enter the browser.
const privateProperty = new RegExp(policy.privatePropertyPattern, 'i');
export function inspectBackupValues(value: unknown, path: string[] = [], depth = 0): void {
  if (depth > policy.maxDepth) throw Error('Backup nesting is too deep.');
  if (typeof value === 'number' && !Number.isFinite(value)) throw Error('Unsafe numeric value.');
  if (typeof value === 'string' && (value.length > policy.maxStringLength || value.includes('\0'))) throw Error('Unsafe backup value.');
  if (!value || typeof value !== 'object') return;
  const dictionary = policy.dictionaryPaths.some(pattern => {
    const parts = pattern.split('.');
    return parts.length === path.length && parts.every((part, i) => part === '*' || part === path[i]);
  }) || (path[0] === 'events' || path[0] === 'sources') && policy.metadataDictionaryProperties.includes(path.at(-1) ?? '');
  for (const [key, child] of Object.entries(value)) {
    if (key.length > policy.maxStringLength || key.includes('\0') || policy.dangerousKeys.includes(key.toLowerCase()) || (!dictionary && privateProperty.test(key))) throw Error('Backup contains unsafe or private fields.');
    // A dictionary identifier exempts only its name, never its structured value.
    inspectBackupValues(child, [...path, key], depth + 1);
  }
}