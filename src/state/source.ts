export type Source = 'metronome' | 'youtube' | 'file';

const STORAGE_KEY = 'timepractice.source.v1';

export function loadSource(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Source {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    return saved === 'youtube' || saved === 'file' ? saved : 'metronome';
  } catch {
    return 'metronome';
  }
}

export function saveSource(source: Source, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(STORAGE_KEY, source);
  } catch {
    // Not persisted; the app just opens on the metronome next time.
  }
}
