/**
 * Bot Status Indicator Component
 * Shows bot connection status and handles recovery UX
 */

'use client';

import { useEffect, useState } from 'react';

interface BotStatus {
  connected: boolean;
  lastHeartbeat: number;
  recovering: boolean;
  message?: string;
}

export function BotStatusIndicator({ attemptId }: { attemptId: number }) {
  const [status, setStatus] = useState<BotStatus>({
    connected: true,
    lastHeartbeat: Date.now(),
    recovering: false,
  });

  useEffect(() => {
    // Poll bot status every 5 seconds
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/bot/status/${attemptId}`);
        const newStatus = await response.json();
        setStatus(newStatus);
      } catch (error) {
        console.error('[BotStatus] Failed to fetch status:', error);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [attemptId]);

  // Check if heartbeat is stale (>30 seconds)
  const isStale = Date.now() - status.lastHeartbeat > 30000;

  if (!status.connected || isStale) {
    return (
      <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50">
        <div className="bg-yellow-600 text-white px-6 py-3 rounded-lg shadow-lg animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-white rounded-full animate-ping" />
            <div>
              <p className="font-bold">⚠️ Bot connection interrupted</p>
              <p className="text-sm">
                {status.recovering
                  ? 'Bot is reconnecting... Stay in the lobby, do not leave!'
                  : 'Waiting for bot to recover... Please stay in the lobby.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status.recovering) {
    return (
      <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50">
        <div className="bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-white rounded-full animate-spin border-2 border-white border-t-transparent" />
            <div>
              <p className="font-bold">🔄 Bot recovering...</p>
              <p className="text-sm">{status.message || 'Checking match history...'}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Bot is healthy - show subtle indicator
  return (
    <div className="fixed top-4 right-4 z-50">
      <div className="bg-green-500 text-white px-3 py-1 rounded-full text-xs flex items-center gap-2">
        <div className="w-2 h-2 bg-white rounded-full" />
        Bot Connected
      </div>
    </div>
  );
}
