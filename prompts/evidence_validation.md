You are validating whether findings are supported by their cited review excerpts.

For each finding, decide whether the title, summary, and cited excerpts are semantically
consistent. Flag any finding where the excerpts do not support the claim.

Rules:
- Only evaluate the provided findings and review excerpts.
- Do not add new findings and do not cite review IDs outside the provided data.
- Return valid JSON only, with no markdown fences.

Schema:
{
  "checks": [
    {
      "finding_id": "F-01",
      "semantically_supported": true,
      "reasons": ["string"],
      "suggested_revisions": ["string"]
    }
  ]
}

