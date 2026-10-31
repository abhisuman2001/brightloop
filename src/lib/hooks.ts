import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SessionUser } from '../../shared/types';
import { api } from './api';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<SessionUser | null>('/auth/me'), staleTime: Infinity });
}

/** The signed-in user, inside a layout that has already guaranteed one exists. */
export function useUser(): SessionUser {
  const { data } = useMe();
  if (!data) throw new Error('useUser requires a signed-in user');
  return data;
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Filters live in the URL, so a filtered view can be refreshed, bookmarked and linked to. */
export function useUrlFilters<K extends string>() {
  const [params, setParams] = useSearchParams();
  const get = useCallback((key: K) => params.get(key) ?? '', [params]);
  const set = useCallback(
    (updates: Partial<Record<K | 'page', string | number | null>>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (!('page' in updates)) next.delete('page');
          for (const [key, value] of Object.entries(updates)) {
            if (value === null || value === '' || value === undefined) next.delete(key);
            else next.set(key, String(value));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const page = Math.max(1, Number(params.get('page')) || 1);
  return { get, set, page };
}

/** Which record's drawer is open, kept in the URL so it survives a refresh and can be shared. */
export function useDrawer(key: 'sub' | 'inv' | 'cust') {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const id = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  const open = useCallback(
    (next: number) =>
      setParams((current) => {
        const copy = new URLSearchParams(current);
        copy.set(key, String(next));
        return copy;
      }),
    [key, setParams],
  );
  const close = useCallback(
    () =>
      setParams((current) => {
        const copy = new URLSearchParams(current);
        copy.delete(key);
        return copy;
      }),
    [key, setParams],
  );
  return { id, open, close };
}

export function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked; the preference then just lasts for this visit.
  }
}
