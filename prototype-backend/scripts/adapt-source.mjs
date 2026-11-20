import path from 'node:path';
export function adaptSource(source, file, base) {
  let contents = source.replaceAll('LOVABLE_API_KEY', 'GEMINI_API_KEY').replaceAll('https://dancefloor-builder.lovable.app', 'https://github.com/jnagan01/dancefloor-builder');
  if (path.basename(file) === 'recommend.functions.ts') {
    const cancel = 'void Promise.resolve(iterator.return?.()).catch(() => {});';
    if (contents.split(cancel).length !== 2) throw Error('Review the upstream stream-deadline adapter before building.');
    contents = `import { drainAbortedIterator } from ${JSON.stringify(path.join(base, 'src/stream-deadline.mjs'))};\n` + contents.replace(cancel, 'drainAbortedIterator(iterator);');
  }
  return contents;
}
