/**
 * Next.js instrumentation hook.
 * Starts the approval polling loop when the server starts.
 * This replaces the separate poller container for development,
 * and also works as a fallback in production.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes

    const poll = async () => {
      try {
        const res = await fetch('http://localhost:3000/api/approval/poll', {
          method: 'POST',
        });
        const data = await res.json();
        if (data.approved || data.rejected) {
          console.log(`[Poller] Synced: ${data.approved} approved, ${data.rejected} rejected`);
        }
      } catch {
        // Server not ready yet or error — silently retry next interval
      }
    };

    // Wait 30 seconds for the server to be ready, then start polling
    setTimeout(() => {
      poll();
      setInterval(poll, POLL_INTERVAL);
    }, 30_000);

    console.log('[Poller] Approval polling scheduled (every 2 minutes)');
  }
}
