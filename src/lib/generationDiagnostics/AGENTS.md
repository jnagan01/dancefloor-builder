# Preparation diagnostics
- Keep diagnostics in a separate bounded account-local IndexedDB outbox; serialize owned writes and fence reads/acknowledgements by session and revision, because logging must never touch event or music persistence.
- Rebuild remote/copy payloads from the shared allowlist; only the authenticated handler reads ingestion secrets, because raw provider errors and identifiers must never leave the device.
- Diagnostic work is best-effort and independent of generation; transport deadlines/backoff never alter preparation budgets or recommendations.
- Synthetic connection checks use the same validated relay with an explicit empty-success marker and informational level, because connection verification must not resemble a real preparation failure.