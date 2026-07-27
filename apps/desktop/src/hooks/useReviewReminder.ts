/**
 * Toast-Erinnerung für offene Review-Gates
 */

import { useEffect, useRef } from 'react';
import { useToastStore } from '@/stores/toastStore';

interface UseReviewReminderOptions {
  checkIntervalMs?: number;
  toastTimeoutMs?: number;
  enabled?: boolean;
}

export function useReviewReminder(options: UseReviewReminderOptions = {}) {
  const {
    checkIntervalMs = 30000,
    toastTimeoutMs = 60000,
    enabled = true,
  } = options;

  const toast = useToastStore();
  const lastReminderTime = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    const checkPendingReviews = async () => {
      try {
        const response = await fetch('http://127.0.0.1:8876/review-gates/pending');
        const data = await response.json();
        const pendingCount = data.gates?.length || 0;

        if (pendingCount > 0) {
          const now = Date.now();
          const timeSinceLastReminder = now - lastReminderTime.current;

          if (timeSinceLastReminder > 300000) {
            toast.warning(
              `${pendingCount} Review${pendingCount > 1 ? 's' : ''} warten`,
              `Jetzt ${pendingCount > 1 ? 'freigeben' : 'freigeben'}`
            );
            lastReminderTime.current = now;
          }
        }
      } catch (error) {
        console.debug('[ReviewReminder] Check failed:', error);
      }
    };

    const intervalId = setInterval(checkPendingReviews, checkIntervalMs);
    return () => clearInterval(intervalId);
  }, [checkIntervalMs, toastTimeoutMs, enabled, toast]);
}
