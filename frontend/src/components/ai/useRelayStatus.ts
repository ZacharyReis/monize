'use client';

import { useEffect, useState } from 'react';
import { aiApi } from '@/lib/ai';

export type RelayState = 'offline' | 'listening' | 'busy';

const POLL_MS = 5000;

/**
 * Polls the reverse MCP relay tunnel status while `enabled`. Returns the live
 * state ('listening' = an agent is connected and idle, 'busy' = handling a
 * prompt, 'offline' = no agent). Shared by the chat indicator and the provider
 * modal so both reflect the same connection state.
 */
export function useRelayStatus(enabled: boolean): RelayState {
  const [state, setState] = useState<RelayState>('offline');

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const poll = () => {
      aiApi
        .getRelayStatus()
        .then((s) => {
          if (active) setState(s.state);
        })
        .catch(() => {
          if (active) setState('offline');
        });
    };
    poll();
    const handle = setInterval(poll, POLL_MS);
    return () => {
      active = false;
      clearInterval(handle);
    };
  }, [enabled]);

  return state;
}
