type Hit = { start: number; decay: number; frequency: number; level: number };

function mechanicalSample(context: AudioContext, duration: number, hits: Hit[]) {
  const rate = context.sampleRate;
  const sample = context.createBuffer(1, Math.ceil(rate * duration), rate);
  const channel = sample.getChannelData(0);
  for (const hit of hits) {
    const first = Math.round(hit.start * rate);
    let noise = 0;
    for (let i = first; i < channel.length; i++) {
      const t = (i - first) / rate;
      noise = .58 * noise + .42 * (Math.random() * 2 - 1);
      const ring = Math.sin(2 * Math.PI * hit.frequency * t);
      const envelope = Math.min(1, t * 1600) * Math.exp(-hit.decay * t);
      channel[i] += hit.level * envelope * (.76 * noise + .24 * ring);
    }
  }
  return sample;
}

function createMechanicalAudio(duration: number, hits: Hit[]) {
  let context: AudioContext | undefined;
  let sample: AudioBuffer | undefined;
  let playing: AudioBufferSourceNode | undefined;

  function prepare() {
    try {
      context ??= new AudioContext();
      if (context.state !== "running") void context.resume().catch(() => {});
    } catch { /* The controls also work on devices without audio. */ }
  }

  function stop() {
    playing?.stop();
    playing = undefined;
  }

  return {
    prepare,
    get ready() { return context?.state === "running"; },
    play() {
      prepare();
      if (!context) return;
      try {
        stop();
        const source = context.createBufferSource();
        source.buffer = sample ??= mechanicalSample(context, duration, hits);
        source.connect(context.destination);
        source.start();
        playing = source;
        source.onended = () => {
          source.disconnect();
          if (playing === source) playing = undefined;
        };
      } catch { /* Playback is optional feedback. */ }
    },
    stop,
    close() {
      stop();
      void context?.close().catch(() => {});
    },
  };
}

export function createShutterAudio() {
  return createMechanicalAudio(.12, [
    { start: 0, decay: 160, frequency: 630, level: .48 },
    { start: .041, decay: 235, frequency: 1040, level: .24 },
  ]);
}

export function createFilmAudio() {
  // A dry ratchet click with a softer catch and release.
  return createMechanicalAudio(.085, [
    { start: 0, decay: 155, frequency: 420, level: .36 },
    { start: .013, decay: 245, frequency: 980, level: .2 },
    { start: .029, decay: 105, frequency: 290, level: .17 },
  ]);
}
