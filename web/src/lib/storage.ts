import { useEffect, useState } from 'react';

export type StudyState = {
  bookmarks: Record<string, string[]>;
  progress: Record<string, { section: string; updated: number }>;
  actions: Record<string, Record<string, boolean>>;
  fontSize: number;
};
export const STORAGE_KEY = 'rangkuman-kajian-study-v1';
const empty = (): StudyState => ({ bookmarks: {}, progress: {}, actions: {}, fontSize: 18 });

export function useStudyState() {
  const [state, setState] = useState<StudyState>(empty);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const valid = saved && typeof saved === 'object' && ['bookmarks', 'progress', 'actions'].every(key => saved[key] && typeof saved[key] === 'object' && !Array.isArray(saved[key]));
        if (!valid || !Object.values(saved.bookmarks).every(value => Array.isArray(value) && value.every(x => typeof x === 'string')) ||
            !Object.values(saved.progress).every((value: any) => value && typeof value.section === 'string' && typeof value.updated === 'number') ||
            !Object.values(saved.actions).every(value => value && typeof value === 'object' && Object.values(value).every(x => typeof x === 'boolean'))) throw new Error('storage shape');
        setState({ ...saved, fontSize: [16, 18, 20, 22].includes(saved.fontSize) ? saved.fontSize : 18 });
      }
    } catch { setStorageError(true); }
    setReady(true);
  }, []);
  const update = (change: (old: StudyState) => StudyState) => {
    setState(old => {
      const next = change(old);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
      catch { setStorageError(true); }
      return next;
    });
  };
  return { state, update, ready, storageError };
}
