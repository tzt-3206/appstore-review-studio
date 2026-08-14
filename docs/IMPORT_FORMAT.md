# Review Import Format

The JSON and CSV importers accept flexible field names and normalize them with the
same deterministic cleaning pipeline used for live collection.

## JSON

An array:

```json
[
  {
    "review_id": "R-001",
    "rating": 1,
    "title": "Subscription issue",
    "content": "I thought this feature was free...",
    "version": "8.2.0",
    "date": "2026-08-01",
    "language": "en"
  }
]
```

Or an object with a `reviews`/`data` array:

```json
{
  "reviews": [
    {
      "review_id": "R-002",
      "rating": 5,
      "content": "Great workout app"
    }
  ]
}
```

## CSV

```csv
review_id,rating,title,content,version,date,language
R-001,1,Subscription issue,I thought this feature was free...,8.2.0,2026-08-01,en
R-002,5,Love it,Great workout app,8.3.0,2026-08-02,en
```

Quoted commas and quoted newlines are supported.

## Accepted Aliases

| Canonical field | Aliases |
| --- | --- |
| `review_id` | `id` |
| `title` | `subject` |
| `content` | `review`, `body`, `comment` |
| `date` | `updated`, `created_at`, `timestamp` |
| `language` | `lang` |
| `author` | `author_name` |
| `vote_count` | `votes` |

Missing ratings or empty content are treated as invalid rows and reported in the
cleaning tab. Duplicate review IDs and identical content fingerprints are removed and
counted.

