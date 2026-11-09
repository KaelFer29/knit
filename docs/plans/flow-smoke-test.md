# Plan: flow smoke test

## T1: Create prueba.md

Branch: docs/flow-smoke-test
Model: auto
Goal: Create a minimal document at the repository root to verify the Knit flow end to end.
Specs:
- S1: "crear un documento como prueba.md en la raíz que diga hello world."
Allowed files:
- prueba.md
Checks:
- grep -q "hello world" prueba.md
