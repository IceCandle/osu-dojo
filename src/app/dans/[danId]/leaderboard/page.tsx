import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/core/prisma';
import { removeScoreV2ModMultiplier } from '@/lib/utils/score-normalization';

type PageProps = {
  params: Promise<{ danId: string }>;
};

function formatBigInt(n: bigint): string {
  const s = n.toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

type LeaderRow = {
  attemptId: number;
  osuUsername: string;
  countryCode: string | null;
  multiplayerUrl: string | null;
  isGoldPass: boolean;
  addedScoreNoMods: bigint;
};

export default async function DanLeaderboardPage({ params }: PageProps) {
  const { danId } = await params;
  const id = Number(danId);
  if (!Number.isFinite(id)) notFound();

  const dan = await prisma.dan.findUnique({
    where: { id },
    include: { danSystem: true },
  });

  if (!dan) notFound();

  // Leaderboard is based on completed passes.
  const attempts = await prisma.attempt.findMany({
    where: {
      danId: id,
      status: 'COMPLETED',
      isNormalPass: true,
    },
    select: {
      id: true,
      isGoldPass: true,
      multiplayerUrl: true,
      user: {
        select: { osuUsername: true, countryCode: true },
      },
      scores: {
        select: {
          score: true,
          modsUsed: true,
          beatmap: {
            select: {
              scoringSystem: true,
            },
          },
        },
      },
    },
    // Pull a bounded set for now; we can denormalize later if needed.
    // Using updatedAt keeps it reasonably fresh when attempts grow.
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 2000,
  });

  const rows: LeaderRow[] = attempts.map((a) => {
    const addedScoreNoMods = a.scores.reduce((sum, s) => {
      if (s.beatmap.scoringSystem === 'SCORE_V2') {
        return sum + removeScoreV2ModMultiplier(s.score, s.modsUsed);
      }
      return sum + s.score;
    }, 0n);

    return {
      attemptId: a.id,
      osuUsername: a.user.osuUsername,
      countryCode: a.user.countryCode ?? null,
      multiplayerUrl: a.multiplayerUrl ?? null,
      isGoldPass: a.isGoldPass,
      addedScoreNoMods,
    };
  });

  rows.sort((a, b) => {
    if (a.addedScoreNoMods === b.addedScoreNoMods) return a.attemptId - b.attemptId;
    return a.addedScoreNoMods > b.addedScoreNoMods ? -1 : 1;
  });

  const top = rows.slice(0, 50);

  const systemLabel = dan.danSystem ? `${dan.danSystem.name} (${dan.danSystem.key})` : 'Standalone';

  return (
    <main className="mx-auto max-w-4xl p-6 text-white">
      <header className="mb-6">
        <div className="text-xs text-white/60">Course leaderboard</div>
        <h1 className="text-2xl font-bold">
          {systemLabel} · {dan.name}
        </h1>
        <div className="mt-2 text-sm text-white/70">
          Ranked by <span className="font-semibold">added score</span> with ScoreV2 mod multipliers
          removed.
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link className="rounded bg-white/10 px-3 py-2 hover:bg-white/20" href="/">
            Home
          </Link>
        </div>
      </header>

      <section className="rounded bg-white/5 p-4">
        <h2 className="mb-3 text-sm font-semibold text-white/80">Top attempts</h2>
        {top.length === 0 ? (
          <div className="text-sm text-white/60">No completed passes yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-white/60">
                <tr>
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">User</th>
                  <th className="py-2 pr-3">Result</th>
                  <th className="py-2 pr-3">Added score</th>
                  <th className="py-2 pr-3">Links</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r, idx) => (
                  <tr key={r.attemptId} className="border-t border-white/10">
                    <td className="py-2 pr-3 tabular-nums text-white/70">{idx + 1}</td>
                    <td className="py-2 pr-3">
                      <span className="font-medium">{r.osuUsername}</span>
                      {r.countryCode ? (
                        <span className="ml-2 text-xs text-white/50">{r.countryCode}</span>
                      ) : null}
                    </td>
                    <td
                      className={`py-2 pr-3 font-semibold ${r.isGoldPass ? 'text-yellow-400' : 'text-green-400'}`}
                    >
                      {r.isGoldPass ? 'GOLD' : 'PASS'}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{formatBigInt(r.addedScoreNoMods)}</td>
                    <td className="py-2 pr-3">
                      <Link
                        className="text-white/80 underline hover:text-white"
                        href={`/attempts/${r.attemptId}/stats`}
                      >
                        stats
                      </Link>
                      {r.multiplayerUrl ? (
                        <>
                          <span className="text-white/40"> · </span>
                          <a
                            className="text-white/80 underline hover:text-white"
                            href={r.multiplayerUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            mp
                          </a>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 text-xs text-white/50">
          Note: This currently ranks from the most recent 2,000 completed passes to avoid heavy
          queries.
        </div>
      </section>
    </main>
  );
}
