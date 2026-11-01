// UI sounds and ambient background music, synthesised with Web Audio (no
// audio files). Both are off by default and configured in the settings page.

const CHORDS = [
  [220.0, 261.63, 329.63], // a-moll
  [174.61, 220.0, 261.63], // F-Dur
  [196.0, 246.94, 293.66], // G-Dur
  [164.81, 196.0, 246.94], // e-moll
]
const CHORD_SECONDS = 9

let ctx = null
let config = { uiSounds: false, uiSoundVolume: 40, ambientMusic: false, ambientVolume: 30 }
let ambient = null
let ducked = false

function audio() {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

/** @param {{uiSounds: boolean, uiSoundVolume: number, ambientMusic: boolean, ambientVolume: number}} settings */
export function configureSounds(settings) {
  config = { ...config, ...settings }
  if (config.ambientMusic && !ambient) startAmbient()
  if (!config.ambientMusic && ambient) stopAmbient()
  if (ambient) setAmbientLevel()
}

const TONES = {
  tap: { freq: 880, to: 660, dur: 0.05, type: 'sine', gain: 0.25 },
  open: { freq: 520, to: 780, dur: 0.09, type: 'triangle', gain: 0.22 },
  close: { freq: 700, to: 420, dur: 0.08, type: 'triangle', gain: 0.2 },
  switch: { freq: 1240, to: 1100, dur: 0.035, type: 'sine', gain: 0.16 },
  success: { freq: 660, to: 990, dur: 0.16, type: 'sine', gain: 0.22 },
}

/** Short, quiet UI feedback sound. */
export function playSound(name) {
  if (!config.uiSounds) return
  const tone = TONES[name]
  if (!tone) return
  const ac = audio()
  const t = ac.currentTime
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = tone.type
  osc.frequency.setValueAtTime(tone.freq, t)
  osc.frequency.exponentialRampToValueAtTime(tone.to, t + tone.dur)
  const peak = tone.gain * (config.uiSoundVolume / 100)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + tone.dur + 0.06)
  osc.connect(gain).connect(ac.destination)
  osc.start(t)
  osc.stop(t + tone.dur + 0.08)
}

/** Ambient music fades out while a tab plays audio (like Opera GX). */
export function setMediaPlaying(playing) {
  if (ducked === playing) return
  ducked = playing
  if (ambient) setAmbientLevel()
}

function setAmbientLevel() {
  const level = ducked ? 0 : (config.ambientVolume / 100) * 0.12
  ambient.master.gain.setTargetAtTime(level, audio().currentTime, ducked ? 0.4 : 1.5)
}

function startAmbient() {
  const ac = audio()
  const master = ac.createGain()
  master.gain.value = 0
  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 900
  filter.Q.value = 0.7
  // Slow filter movement keeps the pad alive.
  const lfo = ac.createOscillator()
  const lfoGain = ac.createGain()
  lfo.frequency.value = 0.05
  lfoGain.gain.value = 350
  lfo.connect(lfoGain).connect(filter.frequency)
  lfo.start()
  filter.connect(master).connect(ac.destination)

  const voices = CHORDS[0].flatMap((f) => [-6, 6].map((detune) => {
    const osc = ac.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = f
    osc.detune.value = detune
    const g = ac.createGain()
    g.gain.value = 0.18
    osc.connect(g).connect(filter)
    osc.start()
    return osc
  }))
  let chord = 0
  const timer = setInterval(() => {
    chord = (chord + 1) % CHORDS.length
    const t = ac.currentTime
    voices.forEach((osc, i) => osc.frequency.setTargetAtTime(CHORDS[chord][Math.floor(i / 2)], t, 1.2))
  }, CHORD_SECONDS * 1000)
  ambient = { master, voices, lfo, timer }
  setAmbientLevel()
}

function stopAmbient() {
  const { master, voices, lfo, timer } = ambient
  ambient = null
  clearInterval(timer)
  const t = audio().currentTime
  master.gain.setTargetAtTime(0, t, 0.4)
  setTimeout(() => {
    for (const osc of [...voices, lfo]) osc.stop()
    master.disconnect()
  }, 2000)
}
