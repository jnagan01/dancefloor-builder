# Reusable public evidence
- Keep evidence validation, exact literal credit/version keys and freshness shared between local and service caches; never store paths, notes, events or raw provider payloads, because reuse must not change selected recording identity or private persistence.
- Load privileged cache adapters only inside authenticated handlers; schema failures are counted fallbacks, not misses or successful writes, because rollout must retain generation safety.
- Retain unresolved shared work until transport settlement, fence consumer acceptance independently and preserve original field dates when facts do not improve, because cancellation and partial refresh cannot create replay storms or false freshness.
