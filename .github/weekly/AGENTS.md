# Weekly CI architecture
- Keep weekly orchestration and reporting independent of push/PR/release workflows; only hosted synthetic tests may run, so user profiles and deployment gates remain untouched.
- Require complete structured suite evidence before declaring health; persist mail delivery state only after SMTP acceptance, so skipped tests and failed delivery remain visible.