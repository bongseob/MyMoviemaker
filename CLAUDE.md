# Claude Instructions

This file is for Claude coding agents working in this repository. Shared project rules live in `PROJECT_RULES.md`; read that first and keep this file focused on Claude-specific workflow.

## Required First Steps

1. Read `PROJECT_RULES.md`.
2. Check the current state with `git status --short --branch`.
3. Inspect the real files involved in the request before proposing or editing.
4. Preserve unrelated local changes and untracked tool folders such as `.claude/`.

## Default Workflow

- For implementation requests, make the change, validate it, and report the result.
- For debugging requests, prove the failing layer or code path before editing.
- For packaging requests, produce the actual artifact instead of stopping at instructions.
- Use `rg` for search and targeted file reads for context.
- Use minimal, focused edits.
- Do not rewrite files or reformat broad areas unless needed for the task.

## Validation Expectations

- For Electron service changes, run:
  - `npm run check:electron`
- For frontend or cross-cutting changes, run:
  - `npm run build`
- Run `npm run lint` when useful, but distinguish pre-existing lint failures from new failures.
- For portable Windows builds, prefer:
  - `powershell -ExecutionPolicy Bypass -File C:\Users\USER\.codex\skills\build-electron-portable\scripts\build-portable.ps1`

## Reporting

- Keep final responses concise and evidence-based.
- Include exact artifact paths for builds.
- Include commit hashes after commits.
- Mention any validation command that failed and whether it appears unrelated.
- Do not include unrelated untracked files in commits.
