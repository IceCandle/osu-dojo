import Link from "next/link";

export default function PlayerNotFound() {
  return (
    <main className="page-shell">
      <section className="empty-card player-empty-card">
        <p className="eyebrow">404</p>
        <h1>로컬 osu!dojo 기록이 없습니다</h1>
        <p>이 사용자에 대해 로컬에 저장된 로그인 또는 run 기록을 찾지 못했습니다.</p>
        <Link className="results-link" href="/">
          Back home
        </Link>
      </section>
    </main>
  );
}
