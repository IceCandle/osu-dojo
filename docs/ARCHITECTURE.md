# osu!dojo Architecture & Status (December 2025)

> **Audience**: New contributors preparing to work on osu!dojo
> **Purpose**: Onboarding-oriented current status, system architecture, and delegation-ready task plan

---

## Table of Contents

1. [Current Status Summary](#current-status-summary)
2. [Docker-First Dev Setup](#docker-first-dev-setup)
3. [Architecture Overview](#architecture-overview)
4. [Core Flows](#core-flows)
5. [Data Model](#data-model)
6. [Operational Topology](#operational-topology)
7. [Known Issues & Risks](#known-issues--risks)
8. [Delegation-Ready Task Plan](#delegation-ready-task-plan)

---

## Current Status Summary

### What Needs Testing

| **Bot (IRC)** | Connects to Bancho, creates lobbies, processes attempts via queue |
| **Attempts** | Full lifecycle: queue → lobby → play → score → completion |
| **Dans/Courses** | Single/multi-map dans with two-tier clear system (normal/gold) |
| **Requirements** | Score, accuracy, misses, combo checks per map + gold variants |
| **Pacemaker Overlay** | tosu WebSocket integration, MY-BEST and RIVAL bars, 3 display modes |
| **Leaderboards** | Per-dan leaderboards with score normalization (mod multiplier removal) |
| **Admin/Auth** | NextAuth osu! OAuth, admin diagnostics API |
| **Recovery** | Zombie lobby detection, stuck-lobby watchdog, match history reconciliation |
| **Replay Upload** | Full validation (timestamp, MD5, player, score matching) |

### What's Risky/Partial/Unclear

| Area                        | Risk Level         | Details                                                                                    |
| --------------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| Scoring accuracy            | ⚠️ Medium          | `ScoringService.ts` has TODO noting mod multiplier values and algorithms need verification |
| S3 storage                  | 🔵 Not Implemented | Storage layer defaults to local; S3 throws "not yet implemented"                           |
| Pacemaker friends/same-rank | 🔵 Not Implemented | Rival modes "friends", "same-rank", "rotate" throw not-implemented errors                  |
| Custom dan creation UI      | 🔵 Partial         | API exists but no frontend for creating dans (admin-only seed currently)                   |
| Mania section accuracy      | ⚠️ Partial         | Schema supports sections but section-score extraction from replays not fully tested        |

### Known Unknowns (Decision Points)

1. **Banner system**: Schema mentions banners but no banner generation/award logic exists yet
2. **Skillset tags**: `skillFocus` field exists on beatmaps but no UI for tag management or search/filter
3. **User-created dans**: Schema supports it but no user-facing creation flow
4. **Multiple variants per tier**: Schema supports `variantIndex` but variant selection logic needs design

---

## Docker-First Dev Setup

### Prerequisites

- Node.js (LTS recommended, tested with v20+)
- Docker & Docker Compose
- osu! IRC credentials from https://osu.ppy.sh/p/irc
- osu! OAuth app from https://osu.ppy.sh/home/account/edit#oauth

### Quick Start

```bash
# 1. Clone and install
git clone
cd osudojo
npm install

# 2. Environment setup
cp .env.example .env
# Edit .env with your credentials (see below)

# 3. Start infrastructure
npm run docker:up          # Starts PostgreSQL + Redis
npm run db:generate        # Generate Prisma client
npm run db:migrate         # Apply migrations

# 4. Run services (two terminals)
npm run dev                # Next.js (port 3000)
npm run bot                # IRC bot (separate terminal)
```

### Environment Variables

| Variable            | Required | Description                          |
| ------------------- | -------- | ------------------------------------ |
| `DATABASE_URL`      | Yes      | PostgreSQL connection string         |
| `REDIS_URL`         | Yes      | Redis connection string              |
| `OSU_IRC_USERNAME`  | Yes      | osu! username for IRC bot            |
| `OSU_IRC_PASSWORD`  | Yes      | IRC password (from osu.ppy.sh/p/irc) |
| `OSU_CLIENT_ID`     | Yes      | OAuth app client ID                  |
| `OSU_CLIENT_SECRET` | Yes      | OAuth app client secret              |
| `OSU_REDIRECT_URI`  | Yes      | OAuth callback URL                   |
| `NEXTAUTH_SECRET`   | Yes      | Random secret for sessions           |
| `NEXTAUTH_URL`      | Yes      | Base URL (http://localhost:3000)     |

### Docker Services

```yaml
osudojo-db: postgres:16-alpine  → localhost:5432
osudojo-redis: redis:7-alpine      → localhost:6379
```

### Verification Commands

```bash
docker compose ps              # Check services are healthy
npm run db:studio              # Open Prisma Studio (DB browser)
npm test                       # Run tests (need DB + Redis running)
npm run build                  # Verify production build
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         osu!dojo System                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     │
│  │   Next.js    │     │   IRC Bot    │     │    tosu      │     │
│  │   (Web App)  │     │  (bancho.js) │     │  (Overlay)   │     │
│  │   Port 3000  │     │              │     │  Port 24050  │     │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘     │
│         │                    │                    │              │
│         │ HTTP/REST          │ IRC                │ WebSocket    │
│         ▼                    ▼                    ▼              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Shared Services                       │    │
│  │  ┌─────────┐ ┌──────────┐ ┌───────────┐ ┌────────────┐  │    │
│  │  │ Prisma  │ │  Redis   │ │  Storage  │ │  osu! API  │  │    │
│  │  │   ORM   │ │  Cache   │ │  (Local)  │ │    v2      │  │    │
│  │  └────┬────┘ └────┬─────┘ └─────┬─────┘ └─────┬──────┘  │    │
│  └───────┼───────────┼─────────────┼─────────────┼──────────┘    │
│          ▼           ▼             ▼             ▼               │
│   ┌────────────┐ ┌────────────┐ ┌────────────┐                  │
│   │ PostgreSQL │ │   Redis    │ │ ./cache/   │                  │
│   │   :5432    │ │   :6379    │ │ (replays)  │                  │
│   └────────────┘ └────────────┘ └────────────┘                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Runtime Components

| Component       | Entry Point            | Purpose                                    |
| --------------- | ---------------------- | ------------------------------------------ |
| **Next.js App** | `npm run dev`          | Web UI, API routes, SSR pages              |
| **IRC Bot**     | `npm run bot`          | Manages multiplayer lobbies via Bancho     |
| **Overlay**     | `/overlay/[attemptId]` | Client-side pacemaker using tosu WebSocket |

### Key Directories

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # REST API routes
│   │   ├── admin/         # Admin diagnostics/management
│   │   ├── attempts/      # Live stats, my-best, rival APIs
│   │   ├── auth/          # NextAuth endpoints
│   │   ├── bot/           # Bot status endpoints
│   │   └── replays/       # Replay upload
│   ├── attempts/          # Attempt stats pages
│   ├── dans/              # Dan leaderboard pages
│   └── overlay/           # Pacemaker overlay page
├── bot/                   # IRC bot runtime
│   ├── index.ts           # Entry point, queue consumer
│   ├── client.ts          # Bancho.js wrapper
│   ├── commands.ts        # DM command handlers (!dojo start)
│   ├── managers/          # MultiplayerManager (lobby orchestration)
│   ├── services/          # Lifecycle, scoring, heartbeat, events
│   └── recovery.ts        # Re-exports from RecoveryService
├── lib/                   # Shared business logic
│   ├── core/              # Prisma, Redis, Storage, Logger
│   ├── repositories/      # Data access layer
│   ├── services/          # Domain services
│   └── utils/             # Helpers, constants
├── types/                 # TypeScript definitions
└── components/            # React components
```

---

## Core Flows

### 1. Dan Attempt Lifecycle

```
User sends "!dojo start <danId>" via osu! DM
                    │
                    ▼
    ┌───────────────────────────────┐
    │  Bot: commands.ts/handleStart │
    │  - Verify user via osu! API   │
    │  - Auto-create User if new    │
    │  - Check attempt limits       │
    │  - Create Attempt (IN_PROGRESS)│
    │  - Enqueue to Redis           │
    └───────────────┬───────────────┘
                    │
                    ▼
    ┌───────────────────────────────┐
    │  Bot: index.ts/processAttempt │
    │  - Dequeue from Redis         │
    │  - Load dan + beatmaps        │
    │  - Generate map order (shuffle)│
    │  - Create multiplayer lobby   │
    │  - Save lobby state to Redis  │
    └───────────────┬───────────────┘
                    │
                    ▼
    ┌───────────────────────────────┐
    │  MultiplayerManager           │
    │  - Invite player              │
    │  - Set beatmap + mods         │
    │  - Start match (5s countdown) │
    │  - Listen for matchFinished   │
    └───────────────┬───────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
  [Map Complete]          [Map Failed/DNF]
        │                       │
        ▼                       ▼
    ┌───────────────────────────────┐
    │  ScoreProcessorService        │
    │  - Fetch sliderbreaks (tosu)  │
    │  - Evaluate requirements      │
    │  - Save AttemptScore to DB    │
    └───────────────┬───────────────┘
                    │
                    ▼
    ┌───────────────────────────────┐
    │  Loop: playNextMap()          │
    │  - If more maps: continue     │
    │  - If last map: finishAttempt │
    └───────────────┬───────────────┘
                    │
                    ▼
    ┌───────────────────────────────┐
    │  AttemptLifecycleService      │
    │  - Calculate total score      │
    │  - Evaluate pass/gold flags   │
    │  - Update Attempt in DB       │
    │  - Clean up Redis state       │
    │  - Close lobby after 10s      │
    └───────────────────────────────┘
```

### 2. Pacemaker Overlay Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  OBS Browser    │     │  osu!dojo API   │     │  tosu (local)   │
│  Source         │     │                 │     │  Port 24050     │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │ Load /overlay/:id     │                       │
         ├──────────────────────►│                       │
         │                       │                       │
         │ Fetch MY-BEST         │                       │
         ├──────────────────────►│                       │
         │ ◄─ Time-series data ──│                       │
         │                       │                       │
         │ Fetch RIVAL           │                       │
         ├──────────────────────►│                       │
         │ ◄─ Time-series data ──│                       │
         │                       │                       │
         │          WebSocket connect                    │
         ├──────────────────────────────────────────────►│
         │                                               │
         │  ◄──── Live gameplay data (score, combo) ────│
         │                                               │
         │  On map complete: POST live-stats            │
         ├──────────────────────►│                       │
         │                       │                       │
         │  Render 3-bar display │                       │
         │  YOU | MY-BEST | RIVAL│                       │
         └───────────────────────┴───────────────────────┘
```

### 3. Two-Tier Clear System

```
For each beatmap in dan:
  ├── requiredScore / requiredAccuracy / maxMisses / minCombo     → NORMAL pass
  └── goldClearScore / goldRequiredAccuracy / goldMaxMisses / goldMinCombo → GOLD pass

Attempt Outcome:
  ├── All maps meet NORMAL requirements → isNormalPass = true
  ├── All maps meet GOLD requirements   → isGoldPass = true
  └── Not all maps pass                 → FINISHED_NO_CLEAR
```

### 4. Recovery Flow

```
Bot Crash/Restart
        │
        ▼
┌───────────────────────────────┐
│  Scan Redis for lobby:* keys  │
│  Find status=PLAYING/RECOVERING│
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│  recoverLobby()               │
│  - Rejoin IRC channel         │
│  - Fetch osu! match history   │
│  - Backfill missing scores    │
│  - Resume from currentMapIndex│
└───────────────┬───────────────┘
                │
        ┌───────┴───────┐
        ▼               ▼
   [Success]      [Fail: Max retries]
        │               │
        ▼               ▼
    Continue       restartAttemptAndRequeue()
    playing        (clean slate, new lobby)
```

---

## Data Model

### Key Entities

```
User ─────────────────────────────────────────────────────────────
  id, osuId, osuUsername, avatarUrl, countryCode
  accessToken, refreshToken, tokenExpiry (OAuth)
  role: PLAYER | MODERATOR | ADMIN
  currentDanRank (progression tracking)

DanSystem ────────────────────────────────────────────────────────
  key (e.g., "reform"), name (e.g., "DDMythical Reform")
  gameMode: OSU | TAIKO | CATCH | MANIA
  isOfficial, creatorId

Dan ──────────────────────────────────────────────────────────────
  name, description, gameMode
  danSystemId → DanSystem (null for standalone)
  tierInSystem (1-10, 11+: Extra)
  variantIndex (for multiple versions of same tier)
  difficultyTier (standalone difficulty rating)
  status: DRAFT | PUBLISHED | ARCHIVED
  requiresReplay (anti-cheat for high-tier)
  totalAttempts, totalPasses, uniquePlayers (stats)
  passReplayId, goldClearReplayId (reference replays)

Beatmap ──────────────────────────────────────────────────────────
  danId, orderIndex (position in course)
  beatmapId (osu! external ID)
  beatmapTitle, beatmapArtist, difficultyName, beatmapCreator
  mods: String[] (e.g., ["HD", "HR"])
  scoringSystem: SCORE_V2 | LAZER
  requiredScore, goldClearScore (BigInt)
  requiredAccuracy, maxMisses, minCombo (optional thresholds)
  goldRequiredAccuracy, goldMaxMisses, goldMinCombo
  skillFocus (e.g., "Jump", "Stream", "LN")
  hasSections (for mania multi-section maps)

Attempt ──────────────────────────────────────────────────────────
  userId, danId
  status: IN_PROGRESS | COMPLETED | ABANDONED
  currentMapIndex, mapsCompleted
  totalScore, averageAccuracy
  isNormalPass, isGoldPass
  multiplayerId, multiplayerUrl
  completedAt

AttemptScore ─────────────────────────────────────────────────────
  attemptId, beatmapId
  score, accuracy, combo
  count300, count100, count50, countMiss
  sliderbreaks, effectiveMisses (OSU mode)
  sliderbreaksSource: TOSU_OVERLAY | UNKNOWN
  passed, metRequirement
  modsUsed

Replay ───────────────────────────────────────────────────────────
  attemptId, beatmapId, userId, danId
  fileName, filePath, fileUrl, fileSize
  score, replayTimestamp (for validation)

BeatmapSection (mania only) ──────────────────────────────────────
  beatmapId, sectionIndex, title, mapper
  noteCount, lnCount
  startTime, endTime
  skillFocus

SectionScore (mania only) ────────────────────────────────────────
  attemptScoreId, sectionId
  accuracy, source, verified
```

### Key Relationships

```
User ──┬── creates ──▶ DanSystem
       ├── creates ──▶ Dan
       ├── has ──────▶ Attempt[] (all attempts)
       └── has ──────▶ Replay[] (uploaded replays)

DanSystem ── contains ──▶ Dan[]

Dan ──┬── has ────▶ Beatmap[] (ordered by orderIndex)
      ├── has ────▶ Attempt[]
      └── references ▶ Replay (passReplay, goldClearReplay)

Attempt ──┬── has ──▶ AttemptScore[] (one per map played)
          └── has ──▶ Replay[] (one per map)

Beatmap ──┬── has ──▶ AttemptScore[]
          ├── has ──▶ BeatmapSection[] (mania)
          └── has ──▶ Replay[]
```

---

## Operational Topology

### Development Setup

```
┌─────────────────────────────────────────────────┐
│              Developer Machine                   │
├─────────────────────────────────────────────────┤
│                                                  │
│  Terminal 1: npm run dev (Next.js :3000)        │
│  Terminal 2: npm run bot (IRC Bot)              │
│                                                  │
│  Docker:                                         │
│    ├── osudojo-db (PostgreSQL :5432)            │
│    └── osudojo-redis (Redis :6379)              │
│                                                  │
│  External (user machine):                        │
│    └── tosu (WebSocket :24050)                  │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Production Topology (Planned)

```
┌────────────────────────────────────────────────────────────┐
│                     Cloud Infrastructure                    │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Web App   │  │   Bot       │  │  Worker     │         │
│  │  (Next.js)  │  │  (Node.js)  │  │  (Future)   │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                          │                                  │
│              ┌───────────┴───────────┐                      │
│              ▼                       ▼                      │
│       ┌────────────┐          ┌────────────┐               │
│       │ PostgreSQL │          │   Redis    │               │
│       │ (Managed)  │          │ (Managed)  │               │
│       └────────────┘          └────────────┘               │
│                                                             │
│  Object Storage: S3/R2 (replays, beatmap cache)            │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

---

## Known Issues & Risks

### Missing Features

1. **Banner system**: No implementation for banner generation/award
2. **Custom dan UI**: No frontend for creating dans
3. **Skillset tag management**: No UI for tags, just raw `skillFocus` field
4. **Variant selection**: Schema supports variants but no selection logic

### Test Coverage

- Unit tests: `attempt-outcome.ts` (9 tests)
- Integration tests: `recovery.test.ts` (2 tests), `simulation.test.ts` (2 tests)
- No E2E tests yet

---

## Delegation-Ready Task Plan

### Stage 1: Unblockers (Pre-delegation)

| Task                                | Scope                          | Success Criteria                               |
| ----------------------------------- | ------------------------------ | ---------------------------------------------- |
| **1.1 Verify dev setup on Windows** | Test docker-compose on Windows | New dev can run full stack locally             |
| **1.2 Create .env.example docs**    | Add comments to .env.example   | All fields documented with where to get values |
| **1.3 Seed data expansion**         | Add more realistic test dans   | Can test full flows without osu!               |

---

### Stage 2: Correctness & Invariants

| Task                              | Scope                                                   | Success Criteria                              |
| --------------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| **2.1 Verify mod multipliers**    | Cross-check ScoringService values with osu! wiki/source | Leaderboard scores are accurate               |
| **2.2 Add E2E test skeleton**     | Playwright or similar for overlay                       | Can catch UI regressions                      |
| **2.3 Fix mania section scoring** | Verify section accuracy calculation                     | Mania dans show correct per-section breakdown |

---

### Stage 3: Onboarding & Maintainability

| Task                          | Scope                            | Success Criteria                    |
| ----------------------------- | -------------------------------- | ----------------------------------- |
| **3.1 Bilingual README**      | English + Korean README          | Both languages complete             |
| **3.2 Add JSDoc to services** | Document all public methods      | IDE hints work everywhere           |
| **3.3 Create ONBOARDING.md**  | Step-by-step guide for each role | New dev productive in <1 day        |
| **3.4 Admin dashboard UI**    | Dan creation, attempt management | Can manage system without DB access |
| **3.5 Implement S3 storage**  | S3StorageProvider class          | Cloud deployment ready              |

---

### Stage 4: Feature Completion

| Task                        | Scope                       | Success Criteria             |
| --------------------------- | --------------------------- | ---------------------------- |
| **4.1 Banner generation**   | Create banner on pass       | Users get banner hyperlink   |
| **4.2 Skillset tag UI**     | Search/filter by tags       | Users can find dans by skill |
| **4.3 Custom dan creation** | User-facing dan builder     | Users can create own dans    |
| **4.4 Friends rival mode**  | Implement friends/same-rank | Full rival mode support      |

---

### Priority Order

```
Week 1: Stage 1 (all tasks) + Stage 2.1-2.2
Week 2: Stage 2.3-2.4 + Stage 3.1-3.3
Week 3: Stage 3.4-3.5
Week 4+: Stage 4 (feature-driven)
```

---

## Quick Reference

### Commands

```bash
# Development
npm run dev          # Start Next.js
npm run bot          # Start IRC bot
npm run db:studio    # Open Prisma Studio

# Database
npm run db:generate  # Generate Prisma client
npm run db:migrate   # Apply migrations
npm run db:seed      # Seed test data
npm run db:reset     # Reset + seed

# Docker
npm run docker:up    # Start containers
npm run docker:down  # Stop containers
npm run docker:logs  # View logs

# Testing
npm test             # Run all tests
npm run test:watch   # Watch mode
npm run build        # Production build
```

### Key URLs (Local Dev)

- Web app: http://localhost:3000
- Overlay: http://localhost:3000/overlay/{attemptId}?ip=localhost
- Leaderboard: http://localhost:3000/dans/{danId}/leaderboard
- Attempt stats: http://localhost:3000/attempts/{attemptId}/stats
- Prisma Studio: http://localhost:5555 (after `npm run db:studio`)

### IRC Commands

```
!dojo           # Show help
!dojo list      # List available dans
!dojo start <id> # Start dan attempt
```

---

_Last updated: December 2025_
