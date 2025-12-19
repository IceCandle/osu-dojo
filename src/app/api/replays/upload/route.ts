import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { getStorage } from '@/lib/core/storage';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/auth-options';
import {
  validateReplayFile as validateReplayFileBasic,
  sanitizeFilename,
  generateReplayPath,
} from '@/lib/utils/file-validation';
import { validateReplayFile } from '@/lib/utils/replay-validation';

/**
 * POST /api/replays/upload
 * Upload replay file for a completed map in a dan attempt
 *
 * Security & Validation:
 * - File type validation (only .osr)
 * - File size limit (10MB max)
 * - Directory traversal prevention
 * - User authorization (verify attemptId belongs to userId)
 * - Replay validation (timestamp, beatmap MD5, player name, score, hit counts)
 * - Duplicate prevention (409 Conflict)
 *
 * Note: Users must upload ONE replay per map in the dan
 */
export async function POST(request: NextRequest) {
  try {
    // Session auth: derive the current user from NextAuth, do not trust client-provided IDs.
    const session = await getServerSession(authOptions);
    const osuId = (session?.user as unknown as { osuId?: number } | undefined)?.osuId;

    if (typeof osuId !== 'number' || !Number.isFinite(osuId)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { osuId },
      select: { id: true, osuUsername: true },
    });

    if (!dbUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const attemptIdStr = formData.get('attemptId') as string | null;
    const beatmapIdStr = formData.get('beatmapId') as string | null;

    // Validate required fields
    if (!file) {
      return NextResponse.json({ error: 'Missing required field: file' }, { status: 400 });
    }

    if (!attemptIdStr || !beatmapIdStr) {
      return NextResponse.json(
        { error: 'Missing required fields: attemptId, beatmapId' },
        { status: 400 },
      );
    }

    const attemptId = parseInt(attemptIdStr, 10);
    const beatmapId = parseInt(beatmapIdStr, 10);

    if (isNaN(attemptId) || isNaN(beatmapId)) {
      return NextResponse.json({ error: 'Invalid attemptId or beatmapId' }, { status: 400 });
    }

    // 1. Basic file validation (type, size)
    const basicValidation = validateReplayFileBasic(file);
    if (!basicValidation.valid) {
      return NextResponse.json({ error: basicValidation.error }, { status: 400 });
    }

    // 2. Check attempt exists and belongs to user
    const attempt = await prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        dan: true,
        user: true,
      },
    });

    if (!attempt) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }

    if (attempt.userId !== dbUser.id) {
      return NextResponse.json(
        { error: 'Forbidden: Attempt does not belong to user' },
        { status: 403 },
      );
    }

    // 3. Check beatmap exists and belongs to this dan
    const beatmap = await prisma.beatmap.findFirst({
      where: {
        id: beatmapId,
        danId: attempt.danId,
      },
    });

    if (!beatmap) {
      return NextResponse.json(
        { error: 'Beatmap not found or does not belong to this dan' },
        { status: 404 },
      );
    }

    // 4. Check for duplicate replay (attemptId + beatmapId unique)
    const existingReplay = await prisma.replay.findUnique({
      where: {
        attemptId_beatmapId: {
          attemptId,
          beatmapId,
        },
      },
    });

    if (existingReplay) {
      return NextResponse.json(
        {
          error: 'Replay already uploaded for this map in this attempt',
          existingReplay: {
            id: existingReplay.id,
            fileName: existingReplay.fileName,
            uploadedAt: existingReplay.uploadedAt,
          },
        },
        { status: 409 },
      );
    }

    // 5. Get the corresponding AttemptScore for validation
    const attemptScore = await prisma.attemptScore.findUnique({
      where: {
        attemptId_beatmapId: {
          attemptId,
          beatmapId,
        },
      },
    });

    if (!attemptScore) {
      return NextResponse.json(
        {
          error: 'No score found for this map in this attempt. Play the map first.',
        },
        { status: 404 },
      );
    }

    // 6. Validate replay file against multiplayer score (CRITICAL ANTI-CHEAT)
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const validation = await validateReplayFile(fileBuffer, attemptScore, beatmap, attempt.user);

    if (!validation.valid) {
      console.warn(`[ReplayUpload] Validation failed for attempt ${attemptId}:`, validation.error);
      return NextResponse.json(
        {
          error: 'Replay validation failed',
          details: validation.error,
        },
        { status: 400 },
      );
    }

    // 7. Save file to storage
    const relativePath = generateReplayPath(attemptId, file.name);
    const storage = getStorage();

    // Ensure directory exists
    await storage.ensureDir(relativePath);

    // Write file content
    await storage.write(relativePath, fileBuffer);

    console.log(`[ReplayUpload] Saved replay file: ${relativePath} (${file.size} bytes)`);

    // 8. Create Replay record in database
    const replay = await prisma.replay.create({
      data: {
        attemptId,
        beatmapId,
        userId: dbUser.id,
        danId: attempt.danId,
        fileName: sanitizeFilename(file.name),
        filePath: relativePath,
        fileSize: file.size,
        score: attemptScore.score,
        replayTimestamp: validation.replay?.timestamp
          ? new Date(validation.replay.timestamp)
          : null,
      },
    });

    console.log(
      `[ReplayUpload] ✓ Created Replay record: ID ${replay.id} for attempt ${attemptId}, beatmap ${beatmapId}`,
    );

    return NextResponse.json(
      {
        success: true,
        replay: {
          id: replay.id,
          fileName: replay.fileName,
          filePath: replay.filePath,
          fileSize: replay.fileSize,
          score: replay.score.toString(),
          replayTimestamp: replay.replayTimestamp,
          uploadedAt: replay.uploadedAt,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('[ReplayUpload] Upload failed:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/replays/upload
 * Returns upload endpoint documentation
 */
export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/replays/upload',
    description: 'Upload replay file (.osr) for a completed map in a dan attempt',
    requiredFields: {
      file: 'File - .osr replay file (max 10MB)',
      attemptId: 'number - Attempt ID',
      beatmapId: 'number - Beatmap ID (which map in the dan this replay is for)',
    },
    validation: {
      timestamp: 'Replay timestamp must match multiplayer play time (±5s)',
      beatmapMD5: 'Replay must be for the correct beatmap',
      playerName: 'Replay must be by the correct player',
      score: 'Replay score must exactly match multiplayer score',
      hitCounts: 'Replay hit counts (300/100/50/miss/combo) must exactly match',
    },
    responses: {
      201: 'Replay uploaded and validated successfully',
      400: 'Invalid request or replay validation failed',
      403: 'Forbidden (attempt does not belong to user)',
      404: 'Attempt/beatmap not found, or no score for this map',
      409: 'Conflict (replay already uploaded for this map)',
      500: 'Internal server error',
    },
    example: `
curl -X POST http://localhost:3000/api/replays/upload \\
  -F "file=@replay.osr" \\
  -F "attemptId=1" \\
  -F "beatmapId=5"
    `.trim(),
  });
}
