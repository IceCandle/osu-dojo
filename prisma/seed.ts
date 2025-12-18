/**
 * Database Seed Script
 * Creates test data for development and testing
 *
 * Run with: npm run db:seed
 * Reset and seed: npm run db:reset
 */

import { PrismaClient, GameMode, DanStatus, AttemptStatus, ScoringSystem } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[Seed] Starting database seed...');

  // Check if seed data already exists
  const existingTestUser = await prisma.user.findFirst({
    where: { osuUsername: 'SeedTestUser' },
  });

  if (existingTestUser) {
    console.log('[Seed] Test data already exists. Skipping seed.');
    console.log('[Seed] To re-seed, run: npm run db:reset');
    return;
  }

  // ============================================
  // 1. CREATE TEST USERS
  // ============================================
  console.log('[Seed] Creating test users...');

  const adminUser = await prisma.user.create({
    data: {
      osuId: 99999999,
      osuUsername: 'SeedTestUser',
      avatarUrl: 'https://a.ppy.sh/99999999',
      countryCode: 'US',
      role: 'ADMIN',
      isActive: true,
    },
  });

  const playerUser = await prisma.user.create({
    data: {
      osuId: 88888888,
      osuUsername: 'SeedPlayer',
      avatarUrl: 'https://a.ppy.sh/88888888',
      countryCode: 'KR',
      role: 'PLAYER',
      isActive: true,
    },
  });

  console.log(`[Seed] ✓ Created users: ${adminUser.osuUsername}, ${playerUser.osuUsername}`);

  // ============================================
  // 2. CREATE DAN SYSTEMS
  // ============================================
  console.log('[Seed] Creating dan systems...');

  const ddMythicalReform = await prisma.danSystem.create({
    data: {
      key: '4ln2',
      name: 'DDMythical Reform',
      description:
        'Official osu!mania 4K dan system focusing on Long Note (LN) patterns and hybrid skills',
      gameMode: GameMode.MANIA,
      isOfficial: true,
      creatorId: adminUser.id,
    },
  });

  const ln2System = await prisma.danSystem.create({
    data: {
      key: 'ln2',
      name: 'LN v2',
      description: 'Advanced Long Note system for experienced mania players',
      gameMode: GameMode.MANIA,
      isOfficial: true,
      creatorId: adminUser.id,
    },
  });

  console.log(
    `[Seed] ✓ Created dan systems: ${ddMythicalReform.name}, ${ln2System.name}`,
  );

  // ============================================
  // 3. CREATE SAMPLE DANS
  // ============================================
  console.log('[Seed] Creating sample dans...');

  // 3.1 Mania 4K Dan (part of DDMythical Reform)
  const gammaDan = await prisma.dan.create({
    data: {
      name: 'Gamma Dan',
      description: '3rd tier of DDMythical Reform system - Tests fundamental LN skills',
      gameMode: GameMode.MANIA,
      danSystemId: ddMythicalReform.id,
      tierInSystem: 3,
      difficultyTier: 3,
      creatorId: adminUser.id,
      status: DanStatus.PUBLISHED,
      isOfficial: true,
      isFeatured: true,
      publishedAt: new Date(),
    },
  });

  // 3.2 Mania 7K Dan (standalone)
  const jinjin7kDan = await prisma.dan.create({
    data: {
      name: "Jinjin 7K Dan I",
      description: 'Entry-level 7-key mania dan for beginners',
      gameMode: GameMode.MANIA,
      danSystemId: null, // Standalone
      tierInSystem: null,
      difficultyTier: 1,
      creatorId: adminUser.id,
      status: DanStatus.PUBLISHED,
      isOfficial: true,
      isFeatured: false,
      publishedAt: new Date(),
    },
  });

  // 3.3 Taiko Dan (standalone)
  const tasukeTaikoDan = await prisma.dan.create({
    data: {
      name: "Tasuke's Taiko Dan - 10th",
      description: 'Intermediate taiko dan focusing on streaming and reading',
      gameMode: GameMode.TAIKO,
      danSystemId: null, // Standalone
      tierInSystem: null,
      difficultyTier: 10,
      creatorId: adminUser.id,
      status: DanStatus.PUBLISHED,
      isOfficial: true,
      isFeatured: true,
      publishedAt: new Date(),
    },
  });

  // 3.4 Standard Dan (DRAFT status)
  const alphaDan = await prisma.dan.create({
    data: {
      name: 'osu!standard Dan - Alpha',
      description: 'Entry-level standard dan (work in progress)',
      gameMode: GameMode.OSU,
      danSystemId: null, // Standalone
      tierInSystem: null,
      difficultyTier: 1,
      creatorId: adminUser.id,
      status: DanStatus.DRAFT,
      isOfficial: false,
      isFeatured: false,
    },
  });

  console.log(
    `[Seed] ✓ Created dans: ${gammaDan.name}, ${jinjin7kDan.name}, ${tasukeTaikoDan.name}, ${alphaDan.name}`,
  );

  // ============================================
  // 4. CREATE BEATMAPS
  // ============================================
  console.log('[Seed] Creating beatmaps...');

  // 4.1 Mania 4K Beatmaps (for Gamma Dan)
  const beatmap1 = await prisma.beatmap.create({
    data: {
      danId: gammaDan.id,
      orderIndex: 0,
      beatmapId: 1234567, // Example osu! beatmap ID
      beatmapTitle: 'ALNILAM',
      beatmapArtist: 'xi',
      difficultyName: 'Reform [LN]',
      beatmapCreator: 'Evening',
      gameMode: GameMode.MANIA,
      mods: ['HD'],
      scoringSystem: ScoringSystem.SCORE_V2,
      requiredScore: BigInt(950000), // 950k for normal clear
      goldClearScore: BigInt(980000), // 980k for gold clear
      skillFocus: 'Long Note',
      starRating: 4.2,
      hasSections: true, // Mania sections enabled
    },
  });

  const beatmap2 = await prisma.beatmap.create({
    data: {
      danId: gammaDan.id,
      orderIndex: 1,
      beatmapId: 7654321, // Example osu! beatmap ID
      beatmapTitle: 'Deconstruction Star',
      beatmapArtist: 'Camellia',
      difficultyName: 'Jack [4K]',
      beatmapCreator: 'Kamuy',
      gameMode: GameMode.MANIA,
      mods: ['HR'],
      scoringSystem: ScoringSystem.SCORE_V2,
      requiredScore: BigInt(940000), // 940k for normal clear
      goldClearScore: BigInt(975000), // 975k for gold clear
      skillFocus: 'Jack',
      starRating: 4.5,
      hasSections: true, // Mania sections enabled
    },
  });

  // 4.2 Taiko Beatmap
  const beatmap3 = await prisma.beatmap.create({
    data: {
      danId: tasukeTaikoDan.id,
      orderIndex: 0,
      beatmapId: 9876543, // Example osu! beatmap ID
      beatmapTitle: 'Freedom Dive',
      beatmapArtist: 'xi',
      difficultyName: 'Inner Oni',
      beatmapCreator: 'TKSalt',
      gameMode: GameMode.TAIKO,
      mods: ['HD', 'HR'],
      scoringSystem: ScoringSystem.SCORE_V2,
      requiredScore: BigInt(960000), // 960k for normal clear
      goldClearScore: BigInt(985000), // 985k for gold clear
      skillFocus: 'Stream',
      starRating: 6.8,
      hasSections: false, // Taiko doesn't use sections
    },
  });

  // 4.3 Standard Beatmap (DRAFT dan)
  const beatmap4 = await prisma.beatmap.create({
    data: {
      danId: alphaDan.id,
      orderIndex: 0,
      beatmapId: 5555555, // Example osu! beatmap ID
      beatmapTitle: 'FREEDOM DiVE',
      beatmapArtist: 'xi',
      difficultyName: 'Extra',
      beatmapCreator: 'Nakagawa-Kanon',
      gameMode: GameMode.OSU,
      mods: [],
      scoringSystem: ScoringSystem.SCORE_V2,
      requiredScore: BigInt(920000), // 920k for normal clear
      goldClearScore: BigInt(970000), // 970k for gold clear
      skillFocus: 'Jump',
      starRating: 7.2,
      hasSections: false, // Standard doesn't use sections
    },
  });

  console.log(
    `[Seed] ✓ Created beatmaps: ${beatmap1.beatmapTitle}, ${beatmap2.beatmapTitle}, ${beatmap3.beatmapTitle}, ${beatmap4.beatmapTitle}`,
  );

  // ============================================
  // 5. CREATE SAMPLE ATTEMPT
  // ============================================
  console.log('[Seed] Creating sample attempt...');

  const attempt = await prisma.attempt.create({
    data: {
      userId: playerUser.id,
      danId: gammaDan.id,
      status: AttemptStatus.IN_PROGRESS,
      multiplayerId: 'mp_11223344', // Example multiplayer ID
      currentMapIndex: 0,
      totalScore: BigInt(0),
      averageAccuracy: 0,
      isNormalPass: false,
      isGoldPass: false,
    },
  });

  console.log(`[Seed] ✓ Created sample attempt: ID ${attempt.id} (IN_PROGRESS)`);

  // ============================================
  // SEED COMPLETE
  // ============================================
  console.log('\n[Seed] ✅ Database seed complete!');
  console.log('\n[Seed] Summary:');
  console.log(`  - Users: 2 (Admin: ${adminUser.osuUsername}, Player: ${playerUser.osuUsername})`);
  console.log(`  - Dan Systems: 2 (${ddMythicalReform.key}, ${ln2System.key})`);
  console.log(`  - Dans: 4 (3 published, 1 draft)`);
  console.log(`  - Beatmaps: 4 (2 mania, 1 taiko, 1 standard)`);
  console.log(`  - Attempts: 1 (IN_PROGRESS)`);
  console.log('\n[Seed] Test credentials:');
  console.log(`  - Admin: osuId=${adminUser.osuId}, username=${adminUser.osuUsername}`);
  console.log(`  - Player: osuId=${playerUser.osuId}, username=${playerUser.osuUsername}`);
}

main()
  .catch((error) => {
    console.error('[Seed] ❌ Error during seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
