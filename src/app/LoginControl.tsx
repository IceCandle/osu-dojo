"use client";

export function LoginControl() {
  function startLogin() {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/api/auth/osu/login?return_to=${encodeURIComponent(returnTo)}`);
  }

  return (
    <button className="site-action site-action-primary" onClick={startLogin} type="button">
      osu!auth Login
    </button>
  );
}
