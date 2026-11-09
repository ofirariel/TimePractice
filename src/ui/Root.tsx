import { useState } from 'preact/hooks';
import { loadSource, saveSource, type Source } from '../state/source';
import { App } from './App';
import { Segmented } from './controls';
import { YouTubeMode } from './YouTubeMode';

export function Root() {
  const [source, setSource] = useState<Source>(loadSource);
  const choose = (s: Source) => {
    saveSource(s);
    setSource(s);
  };
  const picker = (
    <div class="source-picker">
      <Segmented
        label="Play along with"
        value={source}
        options={[
          { value: 'metronome', label: 'Metronome' },
          { value: 'youtube', label: 'YouTube track' },
        ]}
        onChange={choose}
      />
    </div>
  );
  return source === 'youtube' ? <YouTubeMode top={picker} /> : <App top={picker} />;
}
