'use client';

/**
 * Runs one API call and reports its three interesting states: in flight,
 * failed with a documented code, and done.
 *
 * `done` holds the *past-tense name of the action that ran* — "Published to
 * client" for the control labelled "Publish to client". That is a copy rule
 * from DESIGN-SYSTEM.md, and putting it in the hook is how it survives being
 * re-implemented per button.
 */

import { useCallback, useRef, useState } from 'react';
import type { ApiFailure, ApiResult } from '@/lib/api-client.core';

export interface ActionState<T> {
  pending: boolean;
  failure: ApiFailure | null;
  /** Past-tense confirmation, set by the caller when the call succeeds. */
  done: string | null;
  data: T | null;
  reset: () => void;
}

export function useAction<A extends unknown[], T>(
  call: (...args: A) => Promise<ApiResult<T>>,
): ActionState<T> & { run: (doneLabel: string, ...args: A) => Promise<ApiResult<T>> } {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);
  const callRef = useRef(call);
  callRef.current = call;

  const reset = useCallback(() => {
    setFailure(null);
    setDone(null);
  }, []);

  const run = useCallback(async (doneLabel: string, ...args: A): Promise<ApiResult<T>> => {
    setPending(true);
    setFailure(null);
    setDone(null);
    const result = await callRef.current(...args);
    setPending(false);
    if (result.ok) {
      setData(result.data);
      setDone(doneLabel);
    } else {
      setFailure(result);
    }
    return result;
  }, []);

  return { pending, failure, done, data, reset, run };
}
