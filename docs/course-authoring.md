# Course Authoring

Course seed files live in `data/courses/*.json`. The loader reads every JSON file in that directory on seed and fails fast when the shape is unsupported, so treat a new course file like code: keep it small, run the loader tests, and smoke-check the catalog before handoff.

## File Shape

Each file defines one dan system:

```json
{
  "id": "system-test",
  "name": "test",
  "slug": "test",
  "description": "Sample dan system.",
  "dans": []
}
```

System fields:

- `id`: Stable string identifier for seed storage.
- `name`: Public display name. It must match `^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$`.
- `slug`: Internal seed identifier.
- `description`: Text shown on the catalog.
- `dans`: Array of course objects.

Each course object uses this shape:

```json
{
  "id": "dan-test-1dan",
  "name": "1st",
  "courseSlug": "test-1dan",
  "description": "Two-map sample course.",
  "ordinal": 1,
  "scoreModel": "scorev2",
  "overallPassType": "acc",
  "overallPassThreshold": 95,
  "beatmaps": []
}
```

Course fields:

- `id`: Stable string identifier for seed storage.
- `name`: Public display name, using the same display-name rule as systems.
- `courseSlug`: Internal seed identifier. Public commands do not use this.
- `description`: Text shown on the catalog.
- `ordinal`: Integer display order within the system.
- `scoreModel`: Either `scorev1` or `scorev2`.
- `overallPassType`: `acc`, `score`, or `null`.
- `overallPassThreshold`: Number, or `null` when `overallPassType` is `null`.
- `beatmaps`: Array of beatmap objects.

Each beatmap object uses this shape:

```json
{
  "id": "beatmap-test-1",
  "beatmapId": 315,
  "mods": "HR",
  "passConditionType": "acc",
  "passConditionThreshold": 95,
  "ordinal": 1,
  "annotations": ["aim"]
}
```

Beatmap fields:

- `id`: Stable string identifier for seed storage.
- `beatmapId`: osu! beatmap ID as an integer.
- `mods`: Supported stable mod tokens packed into one string. `NM` normalizes to an empty string.
- `passConditionType`: Either `acc` or `score`.
- `passConditionThreshold`: Number compared against the selected metric.
- `ordinal`: Integer play order within the course.
- `annotations`: Array of strings.
- `title`, `artist`, `difficultyName`, `mapper`, `coverUrl`: Optional metadata strings. If omitted, the loader stores empty strings or reuses already-resolved seeded metadata on an existing database.

Supported mod tokens are `EZ`, `NF`, `HT`, `DT`, `HD`, `HR`, `SD`, `NC`, `FL`, `SO`, `PF`, `K4`, `K5`, `K6`, `K7`, `K8`, `FI`, `K9`, `SV2`, and `MR`. Unsupported or duplicate tokens fail validation.

## Public Name Keys

Players and routes use display-name keys, not `slug` or `courseSlug`.

The key is derived from the display name by trimming whitespace, lowercasing, and replacing whitespace runs with `-`. For example:

- System `test` becomes `test`.
- Course `1st` becomes `1st`.
- Course `First Dan` becomes `first-dan`.

The loader hard-fails when two systems produce the same system name key, or when two courses inside one system produce the same course name key. Keep display names unique after lowercasing and whitespace normalization.

## Validation Checklist

Before opening a PR for course data:

1. Add or edit a JSON file under `data/courses/`.
2. Confirm display names match `^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$`.
3. Confirm playable courses have at least one beatmap and every `ordinal` is an integer.
4. Confirm pass conditions use only `acc` or `score`.
5. Confirm score models use only `scorev1` or `scorev2`.
6. Run `pnpm test`.
7. Run `pnpm build`.
8. Start `pnpm dev` and visit `/dan` plus `/dan/<system-name-key>?course=<course-name-key>`.

For a live Bancho smoke check, run `pnpm bot:dev <system-name-key> <course-name-key>` with real local credentials. This is optional for ordinary course-data PRs because it connects to Bancho.

## Common Loader Failures

- A name containing punctuation or hyphens fails the public display-name contract.
- A duplicate display-name key fails even when `id`, `slug`, or `courseSlug` differ.
- Unknown mods such as `RX` fail validation.
- `annotations` must be an array of strings, not a string.
- `overallPassType` and `passConditionType` accept only the current `acc` and `score` shapes. Multiple condition lists are tracked separately in Kanban and are not shipped behavior yet.
