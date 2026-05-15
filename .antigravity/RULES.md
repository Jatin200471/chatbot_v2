# Repository Autonomy Rules — chatwoot-custom-master

Short index of rules. Detailed rules live in `.antigravity/details/rules/`.

---

## Code change rules

- **Stay inside `custom/`.** This is a Chatwoot fork — never edit upstream files unless absolutely necessary. All customizations belong in `custom/widget/`, `custom/backend/`, `custom/dashboard/`. Editing upstream files makes future Chatwoot upgrades painful.
- **Widget changes need a rebuild.** Anything under `custom/widget/` is bundled by Vite at Docker build time. After editing, run `./build.sh` and redeploy. There is no hot-reload in the Docker setup.
- **Don't commit build output.** `custom/widget/assets/vite/` is gitignored. Rebuild it; don't ship it.
- **Don't commit secrets.** `.env` is gitignored. ElevenLabs keys, DB passwords, etc. go there.

## Build / deploy rules

- Use `build.sh` for image builds — pass agent ID/voice ID as args, don't hardcode in source.
- The default agent ID `agent_6601kc1fqeecfc88s7d52jde0syq` is a **fallback only**. Production builds should pass the real ID via build args.
- After a rebuild: `docker compose down && docker compose up -d` to pick up the new image.

## Git rules

- Branch off `main`.
- Commit messages: imperative, lowercase prefix when applicable (`fix:`, `feat:`, etc.) — see git history for style.
- Don't force-push `main`.
- `.harness/` is gitignored (machine-specific). `.antigravity/` IS committed (team-shared SSOT).

## File hygiene

- `*.bak`, `*.bak2`, `*.map` are not allowed in commits (gitignored).
- `logs/` is gitignored.
- Do not introduce new top-level directories without updating `.antigravity/memory.md`.

## Working with the harness

- `.antigravity/RULES.md` (this file), `PLAN.md`, `TASKS.md`, `memory.md` — keep short, link to details under `.antigravity/details/`.
- `agents/state/tasks.json` is the canonical machine-readable task state. `TASKS.md` is the human view.
- After meaningful changes, run `harness validate /d/chatwoot-custom-master` and `dev-rag index`.

## Voice agent rules

- **Feature flag name is `elevenlabs_voice`** (bit 5 in `web_widget.rb`). Never use `voice_agent` for new code — it only exists for backwards-compat in the widget's flag check.
- **`voice_agent_config_data` must be sent as a JSON string from the dashboard**, not a hash. Strong params drops nested hashes for bare-symbol whitelist entries. The controller re-parses it.
- **Always mirror `agent_id` to both** `elevenlabs_agent_id` (column) and `voice_agent_config_data.agent_id` (jsonb) when saving — different consumers read different locations.
- **Never mount `<elevenlabs-convai>`** as a real element. It renders its own floating "Need help?" bubble in `document.body` that cannot be hidden reliably. Use the `@elevenlabs/client` SDK's `Conversation.startSession({ agentId })` instead — no DOM footprint.
- **One call button per widget.** It lives in `ChatInputWrap.vue` next to the emoji button. Do not re-add it to `HeaderActions.vue`.

## Exit / auto-resolve rules

- **Never call `window.location.reload()` to reset the widget.** That caused a white-flash iframe reload and re-fired the parent SDK's `exitChat` handler. Use the soft-exit pattern documented in `memory.md`:
  1. `contacts/softExitChat` → clears state + storage, NO postMessage, NO reload.
  2. `router.replace({ name: 'home' })`.
  3. Post `{ event: 'closeWindow' }` so the SDK collapses the panel.
- **The auto-resolve poller must be gated** on `isWidgetOpen && conversationSize > 0`. Otherwise it spams the console every interval on an empty home view.

## TODO — to be filled by team

- Coding style / linting rules (ESLint, Rubocop config — to be documented)
- Test policy (when are tests required, what's the minimum coverage expectation)
- PR review policy (who approves what)
- Release / tagging strategy
