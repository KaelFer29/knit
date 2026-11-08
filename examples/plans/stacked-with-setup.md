# Plan: stacked feature

Base: main
Setup:
- pnpm install

## T1: Add the settings model

Branch: feat/settings-model
Goal: Add a typed settings model with defaults.
Specs:
- S1: Create src/settings.ts exporting a Settings type and a defaultSettings constant.
- S2: Add src/settings.test.ts checking that defaultSettings satisfies the Settings type.
Allowed files:
- src/settings.ts
- src/settings.test.ts
Checks:
- pnpm test
- pnpm typecheck

## T2: Read settings from the environment

Branch: feat/settings-from-env
Depends: T1
Goal: Build settings from environment variables on top of the model.
Specs:
- S1: Create src/settings-from-env.ts exporting loadSettings(env) that overrides defaultSettings.
- S2: Add src/settings-from-env.test.ts covering an empty env and an overridden value.
Allowed files:
- src/settings-from-env.ts
- src/settings-from-env.test.ts
Checks:
- pnpm test
- pnpm typecheck

## T3: Document the settings

Branch: docs/settings
Goal: Explain the settings in the README.
Specs:
- S1: Add a "Settings" section to README.md listing every setting and its default.
Allowed files:
- README.md
