# Plan: hello greet

## T1: Add greet function

Branch: feat/add-greet
Goal: Add a greet function with a test.
Specs:
- S1: Create src/greet.js exporting greet(name) that returns "Hello, <name>!" (CommonJS, module.exports).
- S2: Create test/greet.test.js using node:test and node:assert that checks greet("Ada") returns "Hello, Ada!".
Allowed files:
- src/greet.js
- test/greet.test.js
Checks:
- node --test

## T2: Document greet

Branch: docs/document-greet
Depends: T1
Goal: Document the greet function in the README.
Specs:
- S1: Add a section titled "## Usage" to README.md that mentions the greet function and shows greet("Ada").
Allowed files:
- README.md
Checks:
- grep -q "greet" README.md
- grep -q "## Usage" README.md
