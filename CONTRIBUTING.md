# Contributing Guide

Thanks for contributing to **figma-keyword-replacer**.  
This document explains how to set up the project, make changes safely, and open high-quality pull requests.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Build & Manual Plugin Verification](#build--manual-plugin-verification)
- [Pull Request Checklist](#pull-request-checklist)
- [Commit Message Tips](#commit-message-tips)
- [Reporting Issues](#reporting-issues)

---

## Code of Conduct

Be respectful, constructive, and collaborative in all discussions and reviews.

---

## Ways to Contribute

You can help by:

- Fixing bugs
- Improving placeholder replacement behavior
- Adding tests
- Improving UI/UX in plugin panel
- Improving build tooling and developer experience
- Improving docs (README, examples, this guide)

---

## Prerequisites

- [Bun](https://bun.sh/) installed (this repo uses Bun for scripts and tests)
- A recent Node-compatible development environment
- Figma desktop app (for manual plugin testing)

---

## Local Setup

1. Clone the repository.
2. Install dependencies:

   `bun install`

3. Run a build:

   `bun run build`

4. Run tests:

   `bun run test`

5. Run lint/format autofixes:

   `bun run lint`

---

## Project Structure

- `src/` — plugin source code
  - `code.ts` — plugin entrypoint
  - `ui.ts`, `ui.html`, `ui.css` — UI layer
  - `plugin/` — core plugin logic (controller, nodes, text processing, backup, state, etc.)
- `scripts/build.ts` — build pipeline for plugin code + standalone UI + manifest copy
- `tests/` — Bun test suite (keyword utility behavior and edge cases)
- `manifest.json` — Figma plugin manifest
- `dist/` — generated build output (do not hand-edit)

---

## Development Workflow

1. **Create a branch** from `main`:
   - `feat/<short-description>`
   - `fix/<short-description>`
   - `docs/<short-description>`

2. **Make focused changes**:
   - Keep PRs scoped to one feature/fix when possible.
   - Avoid mixing refactors with behavior changes unless necessary.

3. **Run checks locally** before opening/updating a PR:
   - `bun run lint`
   - `bun run test`
   - `bun run build`

4. **Update tests/docs** with your change:
   - Add/adjust tests for bug fixes and logic changes.
   - Update README or inline comments if user-facing behavior changes.

---

## Coding Standards

### Language & Style

- Use TypeScript for source files in `src/`.
- Follow existing code patterns and naming conventions.
- Keep functions small and intention-revealing.
- Prefer explicit types where they improve readability/maintainability.

### Formatting & Linting

This project uses **Biome**:

- Run `bun run lint` before committing.
- Current style highlights:
  - Tabs for indentation in JS/TS formatter config
  - Double quotes in JavaScript/TypeScript
  - HTML formatter uses spaces

Do not manually reformat unrelated code just to “clean up” a file. Keep diffs focused.

### Safety & Reliability

- Handle plugin runtime errors clearly (logging + user-safe notifications where appropriate).
- Avoid destructive behavior in text replacement flows.
- Preserve/restore behavior should remain robust against stale data and corruption scenarios.
- Maintain deterministic behavior for matching and replacement logic.

---

## Testing

Run all tests:

`bun run test`

When changing placeholder parsing, variable matching, backup/restore, or fallback recovery logic, add tests in `tests/keyword-utils.test.js`.

Recommended testing approach:

- Add a failing test that reproduces the bug.
- Implement fix.
- Confirm all tests pass.

---

## Build & Manual Plugin Verification

Build artifacts are generated in `dist/` by:

`bun run build`

For iterative work:

`bun run build:watch`

### Manual verification in Figma

1. In Figma desktop, open **Plugins > Development > Import plugin from manifest...**
2. Select `dist/manifest.json` (after running build at least once).
3. Run the plugin on a sample document.
4. Verify:
   - Initialization works
   - Collection selection and toggle behavior
   - Placeholder replacement and restore flows
   - Autocomplete behavior in text editing scenarios
   - No console/runtime errors for your changed paths

---

## Pull Request Checklist

Before requesting review, verify all items:

- [ ] Branch is up to date with target branch
- [ ] Change is scoped and clearly described
- [ ] `bun run lint` passes
- [ ] `bun run test` passes
- [ ] `bun run build` succeeds
- [ ] Tests added/updated for behavior changes
- [ ] Documentation updated if needed
- [ ] No generated artifacts or secrets accidentally committed
- [ ] PR description includes:
  - Problem statement
  - Approach/solution
  - Testing performed
  - Screenshots/GIFs for UI changes (if applicable)

---

## Commit Message Tips

Use clear, imperative commit messages. Examples:

- `fix: prevent stale backup restore from corrupting plain text`
- `feat: improve autocomplete ranking for segmented variable names`
- `docs: add contributing workflow and PR checklist`
- `test: cover adjacent placeholder replacement edge case`

---

## Reporting Issues

When opening a bug report, include:

- What you expected vs what happened
- Reproduction steps
- Sample input text/placeholders
- Plugin version/commit
- Any relevant console logs or error notifications

For feature requests, explain the user workflow and why the current behavior is insufficient.

---

Thanks again for contributing and helping improve the plugin.
