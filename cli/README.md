# patronus-cli

Talk to Patronus from your terminal: log what you shipped, check a job, see your pipeline. Same assistant and same record as the web chat and Telegram.

```bash
npm i -g patronus-cli          # or: npx patronus-cli …
patronus login pat_…           # key from Settings → Channels on patronus.cv
patronus "shipped the retry queue today, p99 down from 900ms to 300ms"
patronus chat
patronus jobs
```

`PATRONUS_API_KEY` and `PATRONUS_URL` override the stored login. The key is stored in `~/.config/patronus/config.json` with mode 600. Revoke it any time in Settings → Channels.

Publishing: `cd cli && npm publish` (the package has no dependencies).
