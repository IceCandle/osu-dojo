import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/core/prisma';

function formatBigInt(n: bigint): string {
  const s = n.toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

type PageProps = {
  params: Promise<{ attemptId: string }>;
};

export default async function AttemptStatsPage({ params }: PageProps) {
  const { attemptId } = await params;
  const id = Number(attemptId);
  if (!Number.isFinite(id)) notFound();

  const attempt = await prisma.attempt.findUnique({
    where: { id },
    include: {
      user: true,
      dan: {
        include: {
          danSystem: true,
        },
      },
    },
  });

  if (!attempt) notFound();

  const certificateWhere =
    attempt.dan.danSystemId != null && attempt.dan.tierInSystem != null
      ? {
          dan: {
            danSystemId: attempt.dan.danSystemId,
            tierInSystem: attempt.dan.tierInSystem,
          },
        }
      : {
          danId: attempt.danId,
        };

  const baseWhere = {
    status: 'COMPLETED' as const,
    ...certificateWhere,
  };

  const [totalCompleted, passCount, goldCount, recentAttempts] = await Promise.all([
    prisma.attempt.count({ where: baseWhere }),
    prisma.attempt.count({ where: { ...baseWhere, isNormalPass: true } }),
    prisma.attempt.count({ where: { ...baseWhere, isGoldPass: true } }),
    prisma.attempt.findMany({
      where: baseWhere,
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: {
        id: true,
        totalScore: true,
        isNormalPass: true,
        isGoldPass: true,
        createdAt: true,
        completedAt: true,
        multiplayerUrl: true,
        user: {
          select: {
            osuUsername: true,
            countryCode: true,
          },
        },
      },
    }),
  ]);

  const passRate = totalCompleted > 0 ? (passCount / totalCompleted) * 100 : 0;
  const goldRate = totalCompleted > 0 ? (goldCount / totalCompleted) * 100 : 0;

  const systemLabel = attempt.dan.danSystem
    ? `${attempt.dan.danSystem.name} (${attempt.dan.danSystem.key})`
    : 'Standalone';

  const certificateLabel =
    attempt.dan.danSystemId != null && attempt.dan.tierInSystem != null
      ? `Tier ${attempt.dan.tierInSystem}`
      : `Dan #${attempt.danId}`;

  const scoreLink = attempt.multiplayerUrl;
  const leaderboardLink = `/dans/${attempt.danId}/leaderboard`;

  return (
    <main className="mx-auto max-w-4xl p-6 text-white">
      <header className="mb-6">
        <div className="text-xs text-white/60">Public pass score statistics</div>
        <h1 className="text-2xl font-bold">
          {systemLabel} · {certificateLabel}
        </h1>
        <div className="mt-2 text-sm text-white/70">
          Opened from attempt <span className="font-semibold">#{attempt.id}</span> by{' '}
          <span className="font-semibold">{attempt.user.osuUsername}</span>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          {scoreLink ? (
            <a
              className="rounded bg-white/10 px-3 py-2 hover:bg-white/20"
              href={scoreLink}
              target="_blank"
              rel="noreferrer"
            >
              Open score link (mp)
            </a>
          ) : (
            <div className="rounded bg-white/5 px-3 py-2 text-white/60">Score link unavailable</div>
          )}
          <Link className="rounded bg-white/10 px-3 py-2 hover:bg-white/20" href={leaderboardLink}>
            Open leaderboard
          </Link>
          <Link
            className="rounded bg-white/10 px-3 py-2 hover:bg-white/20"
            href={`/overlay/${attempt.id}`}
          >
            Back to overlay
          </Link>
        </div>
      </header>

      <section className="mb-8 rounded bg-white/5 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <div className="text-xs text-white/60">Completed attempts</div>
            <div className="text-xl font-bold tabular-nums">{totalCompleted.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-white/60">Pass</div>
            <div className="text-xl font-bold tabular-nums">
              {passCount.toLocaleString()}{' '}
              <span className="text-sm text-white/60">({passRate.toFixed(1)}%)</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-white/60">Gold</div>
            <div className="text-xl font-bold tabular-nums">
              {goldCount.toLocaleString()}{' '}
              <span className="text-sm text-white/60">({goldRate.toFixed(1)}%)</span>
            </div>
          </div>
        </div>
        <div className="mt-3 text-xs text-white/50">
          Shows recent completed attempts (max 50) for the same certificate.
        </div>
      </section>

      <section className="rounded bg-white/5 p-4">
        <h2 className="mb-3 text-sm font-semibold text-white/80">Recent attempts</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-white/60">
              <tr>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Result</th>
                <th className="py-2 pr-3">Total score</th>
                <th className="py-2 pr-3">Completed</th>
                <th className="py-2 pr-3">Link</th>
              </tr>
            </thead>
            <tbody>
              {recentAttempts.map((a) => {
                const result = a.isGoldPass ? 'GOLD' : a.isNormalPass ? 'PASS' : 'FAIL';
                const resultClass = a.isGoldPass
                  ? 'text-yellow-400'
                  : a.isNormalPass
                    ? 'text-green-400'
                    : 'text-red-400';

                return (
                  <tr key={a.id} className="border-t border-white/10">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{a.user.osuUsername}</span>
                      {a.user.countryCode ? (
                        <span className="ml-2 text-xs text-white/50">{a.user.countryCode}</span>
                      ) : null}
                    </td>
                    <td className={`py-2 pr-3 font-semibold ${resultClass}`}>{result}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatBigInt(a.totalScore)}</td>
                    <td className="py-2 pr-3 text-white/70">
                      {a.completedAt ? new Date(a.completedAt).toLocaleString() : '—'}
                    </td>
                    <td className="py-2 pr-3">
                      {a.multiplayerUrl ? (
                        <a
                          className="text-white/80 underline hover:text-white"
                          href={a.multiplayerUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          mp
                        </a>
                      ) : (
                        <span className="text-white/40">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
