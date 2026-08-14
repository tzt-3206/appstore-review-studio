# AI Usage and Model Governance

## Provider and Configuration

The application uses an OpenAI-compatible chat completions API. The cached demo was
generated with:

- Provider: DeepSeek API (`https://api.deepseek.com`)
- Model: `deepseek-v4-pro`
- Temperature: `0.2`
- JSON mode: `response_format: { "type": "json_object" }`

`LLM_PROVIDER=openai` supports any OpenAI-compatible endpoint. Secrets are read from
the environment or `.env`; `.env` is gitignored.

## Model Tasks

| Task | Prompt file | Output |
| --- | --- | --- |
| Scope refinement | `prompts/scope_refinement.md` | focus areas and filter suggestions |
| Topic discovery | `prompts/topic_discovery.md` | dynamic topics from the dataset |
| Classification | `prompts/classification.md` | topic/sentiment assignments |
| Finding generation | `prompts/finding_generation.md` | evidence-grounded findings |
| Evidence validation | `prompts/evidence_validation.md` | semantic consistency checks |
| Version planning | `prompts/version_planning.md` | milestone grouping |
| PRD generation | `prompts/prd_generation.md` | requirements with acceptance criteria |
| Test generation | `prompts/test_generation.md` | test cases linked to requirements |

## Structured Output and Validation

Every model call requests JSON. The application then validates:

- Referenced review IDs exist in the cleaned dataset
- `support_count` equals the actual list length
- Findings reference real topics
- Requirements reference real findings and supported evidence
- Test cases reference the correct requirement-finding pair
- Version targets exist in the version plan

Invalid references are dropped, revised, or marked as assumptions. The UI shows each
revision.

## Retry and Failure Strategy

- Default: 3 attempts with exponential backoff (2s, 4s, 8s), configurable through
  `LLM_MAX_RETRIES` and `LLM_TIMEOUT_MS`.
- If the model is unavailable, deterministic statistics and cleaning results remain
  visible.
- Semantic stages fall back to clearly labeled rule-based outputs or are marked
  unavailable; the application never invents model conclusions.

## Hallucination Mitigation

1. Model prompts forbid inventing review IDs or quotes.
2. Every generated reference is checked against the real review set.
3. `support_count` is recomputed deterministically.
4. Findings with fewer than `MIN_FINDING_SUPPORT` reviews are marked as assumptions.
5. Conflicting reviews are preserved and shown alongside findings.
6. Model-generated conclusions and deterministic statistics are stored as separate
   fields (`model_conclusion` vs `statistical_basis`).
7. Semantically unsupported findings are rejected or revised before PRD generation.

## Deterministic vs Model Responsibilities

Deterministic code owns:

- URL parsing and storefront normalization
- Review field normalization, language detection, and deduplication
- Rating/version/date statistics
- Evidence support counts and confidence scoring
- Reference validation and traceability checks

The model owns:

- Understanding review meaning beyond keywords
- Discovering dataset-specific topics
- Consolidating related feedback into findings
- Writing requirements, version themes, and test cases

If a stage requires the model and the model fails, the pipeline records the error,
keeps deterministic outputs, and lets the user retry or switch data source.

