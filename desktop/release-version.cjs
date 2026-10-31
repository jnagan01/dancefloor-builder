/* Run numbers are monotonic for this single release workflow, including failed runs. */
function releaseVersion(base, run, tag) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(base);
  if (!match || !Number.isSafeInteger(Number(run)) || Number(run) < 1) throw Error('Invalid release version/run');
  const version = `${match[1]}.${match[2]}.${Number(match[3]) + Number(run)}`;
  if (tag && tag !== `v${version}`) throw Error(`Tag must equal v${version}; legacy build tags are no longer release versions.`);
  return { version, tag: `v${version}` };
}
if (require.main === module) {
  const fs = require('node:fs');
  const config = JSON.parse(fs.readFileSync('package.json','utf8'));
  const stamp = releaseVersion(config.version, process.env.GITHUB_RUN_NUMBER, process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
  config.version = stamp.version;
  config.build.publish = { provider: 'github', owner: process.env.GITHUB_REPOSITORY.split('/')[0], repo: process.env.GITHUB_REPOSITORY.split('/')[1], releaseType: 'release' };
  fs.writeFileSync('package.json', JSON.stringify(config,null,2)+'\n');
  fs.writeFileSync('build-info.json',JSON.stringify({repository:process.env.GITHUB_REPOSITORY,...stamp})+'\n');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${stamp.tag}\nversion=${stamp.version}\n`);
}
module.exports = { releaseVersion };