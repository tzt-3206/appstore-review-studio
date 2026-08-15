# Methodology: Why Rules, Statistics, or LLM

Each pipeline stage chooses rules, deterministic statistics, or a language model
based on what the task requires. Data integrity belongs to code; semantic
understanding belongs to the model.

| Stage | Approach | Why |
| --- | --- | --- |
| Scope parsing | Rules + LLM | URL/country/rating/version parsing must be exact and repeatable, so it is deterministic. Free-text goals are semantically refined by the model. |
| Review collection | Rules + HTTP | Apple's official RSS feed is the documented source; pagination, rate limits, retries, and duplicate handling are deterministic to stay safe and reproducible. |
| Cleaning / normalization | Rules | Field types, dates, ratings, whitespace, deduplication, and language detection need identical behavior on every run; an LLM would introduce nondeterminism into data integrity. |
| Language detection | Rules | Unicode ranges plus common stopwords are fast, offline, and deterministic for the mixed-language requirement. |
| Topic discovery | LLM | Topics depend on dataset content and analysis goal; a fixed keyword taxonomy would violate the generalization requirement. |
| Classification | LLM | Assigning reviews to dynamic topics requires understanding meaning beyond keywords; rule fallback is clearly labeled. |
| Finding generation | LLM + rules | The model consolidates semantic feedback; deterministic validation recomputes support counts and rejects nonexistent review IDs. |
| Evidence validation | Rules + LLM | Support thresholds, ID checks, and conflict counts are deterministic; the model only checks semantic consistency between findings and excerpts. |
| Version planning | LLM + rules | The model groups findings and names milestones dynamically; deterministic scores use severity, confidence, support, and conflict data. |
| PRD generation | LLM + rules | The model writes requirements from findings; code validates that every requirement traces to a real finding and real reviews. |
| Test generation | LLM + rules | The model writes test steps from requirements; code validates requirement/finding/source-review links and keeps expected results grounded in review problems. |
| Traceability | Rules | Review -> Finding -> Requirement -> Test is a graph that must be checked exactly; rules are the only correct tool. |

## Failure Boundaries

- If the LLM fails, deterministic cleaning and statistics remain visible.
- Semantic stages either fall back to clearly labeled rule-based output or are
  marked unavailable; the application never presents a fallback as model output.
- If Apple's feed is temporarily empty, the collector retries both sort orders and
  the UI offers Retry, JSON/CSV import, or demo mode.

