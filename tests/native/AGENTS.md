# Synthetic native boundaries
- Keep React fixture renderers on esbuild's browser platform with actual activity UI/local diagnostic storage and stubbed relay/auth services; standalone offline/race harnesses use the real desktop offline assets with network denial, because no test bundle may import server runtime or production credentials.
- Fixture Electron mains install desktop/security.cjs permission handlers exactly as desktop/main.cjs, and clipboard checks read the real system clipboard, because mocked permissions hid the installed-shell copy failure.
- Await generationReady before post-generation page assertions: saved results precede modal completion dwell, so accessibility readiness cannot be inferred from fixed sleeps or storage alone.
