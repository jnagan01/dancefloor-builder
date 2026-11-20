// The shared handler has already aborted its provider request at this point.
// Cancelling the SDK's outer iterator before the provider opens causes a second
// close in ai@6.0.207 and an unhandled rejection. Drain its aborted cleanup
// instead, without awaiting it on the HTTP request's deadline path.
export function drainAbortedIterator(iterator) {
  void (async () => {
    try { while (!(await iterator.next()).done) { /* discard late output */ } }
    catch { /* The request already reports the deadline; cleanup is observed. */ }
  })();
}
