# Codex Rules

## 1. Read First

Always read these files before making changes:

1. `docs/PROJECT_SPEC.md`
2. `docs/CODEX_RULES.md`
3. `AGENTS.md`

## 2. Bilingual Product Boundary

This public repository contains only the bilingual Windows desktop product for HavenFrame / 栖构. Do not add Android or iOS client source.

Chinese and English UI must use the same business logic, model routes and data schemas. User-created content must not be translated automatically.

Do not add dynamic short-film generation workflows.

## 3. Development Style

- Build phase by phase.
- Prefer runnable skeletons over fake completeness.
- Keep modules decoupled.
- Keep code typed and structured.
- Use mock data before real provider integration.
- Use real provider calls only through existing task/provider services.

## 4. Stack Constraints

Required stack:

- Tauri
- React
- TypeScript
- Vite
- Tailwind CSS
- Zustand
- TanStack Query
- FastAPI
- SQLite

## 5. Workflow Constraints

- All generation actions must go through the task queue.
- Do not run heavy generation logic directly in UI components.
- Use adapters for model integration.
- Keep provider-specific logic out of page components.

## 6. Provider Rules

- Treat Google Gemini as an official built-in provider.
- Do not model Nano Banana / Nano Banana Pro / Nano Banana 2 as standalone providers.
- Put Nano Banana image presets under Google Gemini.
- Support both `direct_api` and `relay_base_url`.
- Keep per-module model priority configurable.
- Keep OpenAI `gpt-image-2` as the default image generation flow.
- Do not add ComfyUI, local deployment, local model management, or local renderer product capabilities.

## 7. UI Constraints

- Keep Chinese mode fully Chinese and English mode fully English.
- Keep model IDs, endpoints, API payloads and user-created data unchanged across languages.
- Keep the creative workstation feel.
- Prioritize large image previews.
- Keep model parameters clear and close to each workflow.
- Keep task queue available without covering the workspace.

## 8. Data Rules

- Persist project/task-related data through clear schemas.
- Keep task status normalized.
- Keep asset metadata extensible with `metadata_json`.
- Persist `prompt_snapshot_json` and `params_snapshot_json` on tasks.
- Persist project archive path and review snapshots.

## 9. Done Means

A task is done only when:

- The project still matches the Chinese MVP boundary.
- Relevant tests or smoke checks were run.
- README or developer docs are updated if commands or boundaries changed.
- The final response lists commands run, results, files changed, and remaining risks.
