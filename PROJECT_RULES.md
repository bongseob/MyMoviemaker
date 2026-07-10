# Project Rules

This file is the shared source of truth for this project. Any agent or human working on this repository should read this file before making changes. Tool-specific instructions belong in tool-specific files such as `AGENTS.md`, not here.

## Project Shape

- This is an Electron desktop app for making short videos from images, audio, article summaries, captions, and SRT subtitles.
- The runtime stack is React, Vite, TypeScript, Electron, FFmpeg, and OpenAI APIs.
- The Electron main process and backend services live under `electron/`.
- The React UI lives under `src/`.
- Automation and diagnostic probes live under `scripts/`.
- Generated artifacts are intentionally not source of truth: `dist/`, `release/`, and `electron/outputs/` are build/runtime outputs.

## Source Of Truth

- Prefer real repository files, runtime output, and current git state over assumptions.
- Check `package.json` before changing build, packaging, or runtime commands.
- Check the relevant Electron service before changing behavior:
  - `electron/services/video-export.cjs` for video rendering and FFmpeg behavior.
  - `electron/services/subtitle-refiner.cjs` for SRT generation, SRT saving, and subtitle correction.
  - `electron/services/subtitle-utils.cjs` for SRT timing/length normalization.
  - `electron/services/tiktok.cjs` and `electron/services/instagram.cjs` for social upload automation.
  - `electron/services/suno.cjs` for Suno-related automation.
  - `electron/services/article.cjs` for article summarization prompts.
- Do not infer behavior from README text alone. README may be stale or terminal-encoding-garbled.

## Secrets And Local State

- Never commit `.env`, real API keys, browser session data, generated videos, generated SRTs, release artifacts, or local diagnostic output.
- Keep `.env.example` placeholder-only.
- Build outputs belong in ignored folders such as `dist/`, `release/`, and `electron/outputs/`.
- Existing untracked local tool folders such as `.claude/` should not be modified or committed unless the user explicitly asks.

## Subtitle Rules

- SRT generation should preserve musical or spoken timing as much as possible.
- Do not split subtitle text blindly by character count if timing data or existing SRT segment boundaries are available.
- The current intended pipeline is:
  1. Generate or load SRT.
  2. Normalize only overly long subtitle segments.
  3. Preserve the original segment start/end range when redistributing split subtitles.
  4. Run typo/spacing correction after structural normalization.
- The typo correction prompt should focus on text accuracy and should not be asked to redesign timing.
- When changing subtitle behavior, test both:
  - MP3-to-SRT generation path.
  - Existing SRT refinement path.

## Video Export Rules

- FFmpeg path handling must support Windows paths.
- Keep Korean font compatibility in mind. Prefer existing platform font fallback patterns.
- Subtitle burn-in uses FFmpeg `subtitles`; path escaping is fragile and must be tested after edits.
- Preserve output compatibility defaults unless there is a concrete reason to change them:
  - `libx264`
  - `aac`
  - `yuv420p`
  - `25fps`

## Social Upload Automation

- TikTok and Instagram upload automation depends on real browser DOM behavior and can drift.
- Prefer real probe scripts under `scripts/` when validating upload automation.
- Do not click final publish/share buttons in probes unless the user explicitly asks for a real publish.
- Caption fields on social sites may require real focus and keyboard input events. Avoid replacing proven focus/typing methods with simple DOM value assignment.

## Build And Verification

- Standard app build:
  - `npm run build`
- Electron CommonJS syntax check:
  - `npm run check:electron`
- Lint:
  - `npm run lint`
  - Current lint may fail on pre-existing issues; report whether failures are related to the current change.
- Windows portable build:
  - Prefer the existing portable-build workflow or run `npm run build` followed by `npx electron-builder --win portable --x64`.
  - Keep or create a clearly named latest copy:
    - `release/AntigravityMovieMaker-0.0.0-windows-x64-portable-latest.exe`
- Known non-fatal packaging warnings:
  - Missing `description` or `author` in `package.json`.
  - Missing app icon causing the default Electron icon to be used.
  - `cannot find path for dependency name=undefined reference=undefined`.

## Git Hygiene

- Check `git status --short --branch` before editing and before final reporting.
- Do not stage unrelated files.
- Do not commit generated output unless the user explicitly asks.
- Keep commits focused and name the behavior changed.
- If asked to push, push only after validation has run or after clearly reporting any validation gap.

## Documentation

- Keep user-facing Korean UI labels and Korean documentation in Korean.
- If PowerShell displays Korean as mojibake, do not assume file corruption. Verify with a UTF-8-aware read or another tool before changing text.
- Document durable decisions in shared files. Tool-specific shortcuts, prompt habits, or agent-only workflow notes should go in tool-specific files.
