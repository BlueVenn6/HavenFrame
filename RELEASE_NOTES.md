# HavenFrame / 栖构 0.2.0-rc.12 Release Notes

## Release scope

`0.2.0-rc.12` is the bilingual Windows release candidate built from the
`bilingual-cn-en-20260716` release line. Chinese and English use the same
projects, workflows, provider routes, task queue, assets, and report schemas.

This product does not expose a local-deployment page, local model service, or
local renderer. The Windows application still bundles its private FastAPI,
SQLite, workspace, and task-queue sidecar as application infrastructure.

## Included workflows

- Projects and local archive/history.
- Floor-plan 2D/3D image generation.
- Independent single-room board generation, GLM extraction, review, report,
  table export, and optional budget/procurement data.
- Independent multi-room board generation, extraction, review, report, and
  table export.
- Space rendering with optional reference images and optional extraction.
- Custom tasks, prompts, and model settings.

## Provider boundaries

- Image generation: OpenAI `gpt-image-2` native or compatible relay, and
  supported Google Gemini image models.
- Extraction: Zhipu GLM Mainland China native API, Z.AI international API, or
  an explicitly configured compatible vision relay.
- Generation and extraction configurations are stored independently.
- No API key, relay URL, project, task, or generated image is bundled as
  release seed data.
- Provider availability still depends on the user's credentials, quota, and
  network path. Connection checks do not replace a real workflow call.

## Report delivery

- Single-room and multi-room image prompts require a restrained editorial
  layout with concise section headings, representative samples, and explicit
  whitespace limits. They no longer permit a text-free, overcrowded collage.
- Single-room and multi-room reports use an A4 portrait SVG layout.
- Chinese, English, and mixed long text wrap within fixed A4 regions without
  ellipses; pathologically long values are rejected with a clear error rather
  than producing an incomplete client report.
- Material and color summaries use measured vertical layout so multiline
  content cannot overlap adjacent headings.
- Client reports omit Provider names, model IDs, and other implementation
  details; complete overflow records remain available in structured tables.
- Structured CSV exports use real project/review data and UTF-8 BOM.
- Report generation, extraction, review, budget entry, and image generation
  remain independent unless an operation has a real technical dependency.

## Windows artifact policy

The release build must be produced locally from a clean Git commit. The build
script creates a manifest beside the single NSIS installer containing:

- Git commit and clean-worktree state.
- Build start and finish timestamps.
- Frontend bundle SHA-256 values.
- Desktop executable and sidecar SHA-256 values.
- Installer absolute source path, size, and SHA-256.

The installer is not considered validated merely because packaging succeeds.
It must be installed from the exact recorded file and tested as a packaged
application before the release can reach State D.

## Signing and distribution

This release candidate is not code-signed. Windows may show an unknown
publisher or SmartScreen warning. Distribute it only through a controlled
beta channel together with its SHA-256 manifest. Public release should use a
trusted Windows signing certificate.

## Data and uninstall behavior

Windows application data is stored below:

```text
%LOCALAPPDATA%\com.havenframe.desktop\
```

Uninstalling the application does not automatically delete projects, outputs,
or saved configuration. A clean-profile acceptance test must use an isolated
application-data directory or a separate test account; existing user data must
not be deleted to simulate a clean install.

## Validation sources

- `docs/PRE_PACKAGE_DELIVERY_CHECKLIST.md`
- `docs/USER_GUIDE_BILINGUAL.md`
- The generated `havenframe-0.2.0-rc.12-release-manifest.json`

Android is built locally only after the Windows candidate is accepted. iOS
cloud build remains blocked until local Android device validation passes and
the user explicitly approves the iOS build.
