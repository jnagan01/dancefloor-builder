/* Read-only artifact gate; CI also checks Developer ID and notarization with Apple tools. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
function verifyRelease(directory, expected, parse) {
  const manifest = parse(fs.readFileSync(path.join(directory,'latest-mac.yml'),'utf8'));
  if (manifest.version !== expected) throw Error('Feed version differs from app version');
  for (const extension of ['zip','dmg']) {
    const entry = manifest.files?.find(file => file.url.endsWith(`.${extension}`));
    if (!entry || path.basename(entry.url) !== entry.url) throw Error(`Missing/unsafe ${extension} asset`);
    const bytes = fs.readFileSync(path.join(directory,entry.url));
    if (bytes.length !== entry.size || crypto.createHash('sha512').update(bytes).digest('base64') !== entry.sha512) throw Error(`Invalid ${extension} feed checksum`);
  }
  return manifest;
}
if (require.main === module) verifyRelease('release',require('./package.json').version,require('js-yaml').load);
module.exports = { verifyRelease };