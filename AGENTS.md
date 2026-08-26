# AGENTS.md

Repository instructions for AI agents working on contentfactory-publisher.

## Start
1. Check git status: `git status --short`.
2. Do not overwrite or commit secrets (`.env`, `.tokens/`).
3. Keep changes focused and modular.
4. Each platform lives strictly within `modules/<platform>/`.

## Validated Commands
- `npm install`
- `npm run auth:youtube`
- `node worker.mjs --help`
- `npm test`
