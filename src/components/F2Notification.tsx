'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useEffect, useState } from 'react';

interface F2NotificationProps {
  show: boolean;
  countdown: number;
  onComplete?: () => void;
}

/**
 * F2 Notification Component
 *
 * Displays a prominent notification when player passes a map,
 * prompting them to press F2 to save replay before next map starts.
 *
 * Usage:
 * ```tsx
 * const [showF2, setShowF2] = useState(false);
 * const [countdown, setCountdown] = useState(5);
 *
 * // Trigger when pass detected:
 * if (score >= requiredScore) {
 *   setShowF2(true);
 *   setCountdown(5);
 * }
 *
 * <F2Notification show={showF2} countdown={countdown} />
 * ```
 */
export function F2Notification({ show, countdown, onComplete }: F2NotificationProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (show) {
      setVisible(true);
    } else {
      // Delay hiding to allow fade-out animation
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [show]);

  useEffect(() => {
    if (countdown <= 0 && onComplete) {
      onComplete();
    }
  }, [countdown, onComplete]);

  if (!visible) return null;

  return (
    <div
      className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] transition-all duration-300 ${
        show ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
      }`}
    >
      <Alert className="w-96 bg-green-500/95 border-green-600 border-4 text-white shadow-2xl animate-pulse backdrop-blur-sm">
        <AlertTitle className="text-3xl font-bold text-center mb-2">✅ PASS DETECTED!</AlertTitle>
        <AlertDescription className="space-y-2">
          <div className="text-2xl font-semibold text-center">
            Press <kbd className="px-3 py-1 bg-white text-green-600 rounded font-mono">F2</kbd> to
            save replay
          </div>
          <div className="text-xl text-center font-mono">
            {countdown > 0 ? `${countdown}s remaining` : 'Starting next map...'}
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}

/**
 * Hook for managing F2 notification state
 *
 * @example
 * ```tsx
 * const { showNotification, countdown, triggerF2Notification } = useF2Notification();
 *
 * // When pass detected:
 * if (passed) {
 *   triggerF2Notification(5); // 5 second countdown
 * }
 *
 * return <F2Notification show={showNotification} countdown={countdown} />
 * ```
 */
export function useF2Notification() {
  const [showNotification, setShowNotification] = useState(false);
  const [countdown, setCountdown] = useState(5);

  const triggerF2Notification = (initialCountdown: number = 5) => {
    setCountdown(initialCountdown);
    setShowNotification(true);

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setShowNotification(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  };

  return {
    showNotification,
    countdown,
    triggerF2Notification,
  };
}
