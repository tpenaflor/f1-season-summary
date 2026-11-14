# F1 Season Summary — Agent Instructions

## Codebase Structure & Fast Navigation
- `index.html` (~15,250 lines) is a single-file web application containing CSS, HTML tab containers, and JavaScript logic (Chart.js visualizations, Jolpica F1 API fetching via `fetchWithRetry` and `fetchAllJolpicaPages`, and tab switching via `switchMainTab`).
- `test/` contains Node.js unit and integration tests using the built-in `node:test` runner.

## Critical Efficiency Rules (Preventing Timeouts)
1. **Do NOT use repeated `sed`, `head`, or `tail` shell commands to read `index.html`.**
   - First, run a single `rg -n "<pattern>" index.html` command to locate exact line numbers (e.g., `switchMainTab`, `fetchAllJolpicaPages`, or the end of `<script>`).
   - Then, use your native `read_file` tool with `StartLine` and `EndLine` (which reads up to 800 lines at once) to inspect the target section, and `edit_file` to make surgical edits.
2. **Run Targeted Tests Only During Iteration:**
   - Do NOT run the full `npm test` suite repeatedly while developing.
   - Run only the specific test file you created or modified:
     ```bash
     node --test test/<your-feature>.test.js
     ```
3. **Jolpica API Conventions:**
   - `fetchWithRetry(url)` already unwraps and returns the parsed JSON object (`await response.json()`), NOT a raw Fetch `Response`. Do not check `resp.ok` or call `resp.json()` on the return value of `fetchWithRetry`.
