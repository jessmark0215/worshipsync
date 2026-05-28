// ============================================================
// WORSHIPSYNC · js/pages/studio.js
// Audio Studio — chord charts, audio playback with speed + pitch
// shift, MD notes, and a link-out for stem splitting.
//
// Permission model (simple / app-enforced):
//   - All verified users can read everything and play audio.
//   - Only the Music Director assigned to a song's parent event (or an
//     admin) can upload audio, edit chord text, change MD notes, or
//     upload a chord chart image. This is enforced HERE in the UI —
//     non-MDs never see upload/edit controls. Files live in Supabase
//     Storage (see SUPABASE_SETUP.md); chord text / notes live in the
//     event doc in Firestore (firestore.rules covers those).
// ============================================================

import { $, $$, esc, showToast, openModal, closeModal } from '../shared/ui.js';
import {
  currentUser, events, isAdmin,
  persistEvent, updateSong, findSongById,
  onDataChange,
} from '../shared/data.js';
import { initShell } from '../shared/shell.js';
import { uploadFile, deleteFile, MAX_UPLOAD_BYTES, formatBytes } from '../shared/storage.js';
import { transposeText, shiftKey } from '../shared/chords.js';

// ============================================================
// LOCAL STATE
// ============================================================
const ui = {
  activeSongId: null,    // currently-selected song id (or null = empty state)
  search: '',
  chordTab: 'text',      // 'text' | 'image' | 'notes'
  uploadingAudio: false,
  uploadingChart: false,
};

// Audio engine.
// ARCHITECTURE: a plain HTML5 <audio> element is the single source of
// truth for playback, position, speed and loop (rock-solid, no drift).
// For PITCH SHIFT we route that element through the Web Audio graph:
//     <audio> → MediaElementSource → Tone.PitchShift → destination
// Tone.js (~130KB) is loaded lazily the first time the user nudges the
// pitch control, so chord-only visitors never pay for it. If Tone fails
// to load (offline, CSP), pitch shift is disabled but everything else
// keeps working.
const engine = {
  el: null,            // HTMLAudioElement
  currentSongUrl: null,
  speed: 1,
  semitones: 0,
  loop: false,

  // Web Audio / Tone (pitch) — all null until first pitch nudge
  toneLoaded: false,
  toneFailed: false,
  Tone: null,
  ctx: null,           // AudioContext (shared with Tone)
  mediaSource: null,   // MediaElementAudioSourceNode (created once per <audio>)
  pitchNode: null,     // Tone.PitchShift
  routed: false,       // whether mediaSource is wired through pitchNode
};

// ============================================================
// HELPERS
// ============================================================
function getActiveSong() {
  if (!ui.activeSongId) return null;
  return findSongById(ui.activeSongId);
}

function isUserMDForEvent(event) {
  if (!event || !currentUser) return false;
  if (isAdmin()) return true;
  return (event.team || []).some(t =>
    t.userId === currentUser.id &&
    t.role === 'Music Director' &&
    t.status === 'accepted'
  );
}

// Format seconds as M:SS
function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Date label for the sidebar event header (e.g. "Sun, May 31")
function eventDateLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ============================================================
// SIDEBAR — all songs across all events
// ============================================================
function renderSongList() {
  const q = ui.search.toLowerCase().trim();
  // Group by event, preserving the project-wide ordering (events are
  // already sorted by date ascending in data.js).
  const groups = [];
  for (const ev of events) {
    const matchingSongs = (ev.setlist || []).filter(s => {
      if (!q) return true;
      return (
        (s.title || '').toLowerCase().includes(q) ||
        (s.artist || '').toLowerCase().includes(q) ||
        (s.key || '').toLowerCase().includes(q) ||
        (ev.title || '').toLowerCase().includes(q)
      );
    });
    if (matchingSongs.length) groups.push({ event: ev, songs: matchingSongs });
  }

  if (groups.length === 0) {
    return `
      <div class="studio-side-empty">
        ${q
          ? `<i data-lucide="search-x"></i><p>No songs match "${esc(q)}"</p>`
          : `<i data-lucide="music-2"></i><p>No songs yet. Music directors add songs from their event in My schedules.</p>`
        }
      </div>
    `;
  }

  return groups.map(g => `
    <div class="studio-side-group">
      <div class="studio-side-group-head">
        <p class="studio-side-group-title">${esc(g.event.title)}</p>
        <p class="studio-side-group-date">${esc(eventDateLabel(g.event.date))}</p>
      </div>
      <ul class="studio-side-songs">
        ${g.songs.map(s => `
          <li>
            <button class="studio-side-song ${ui.activeSongId === s.id ? 'is-active' : ''}"
                    data-song-id="${esc(s.id)}"
                    style="--song-color: ${s.color || 'var(--accent)'};">
              <span class="studio-side-song-dot"></span>
              <span class="studio-side-song-body">
                <span class="studio-side-song-title">${esc(s.title)}</span>
                <span class="studio-side-song-meta">
                  <span>${esc(s.key || '—')}</span>
                  ${s.audioFile?.url ? '<span class="studio-side-song-badge"><i data-lucide="circle-play"></i></span>' : ''}
                  ${s.chordChart || s.chordChartImage ? '<span class="studio-side-song-badge"><i data-lucide="music-2"></i></span>' : ''}
                </span>
              </span>
            </button>
          </li>
        `).join('')}
      </ul>
    </div>
  `).join('');
}

// ============================================================
// WORKSPACE
// ============================================================
function renderWorkspace() {
  const ctx = getActiveSong();

  if (!ctx) {
    return `
      <div class="studio-empty">
        <div class="studio-empty-icon"><i data-lucide="audio-waveform"></i></div>
        <h3>Pick a song to start practicing</h3>
        <p>Audio playback with speed + pitch control, transposable chord charts, and notes from your music director.</p>
      </div>
    `;
  }

  const { event, song } = ctx;
  const canEdit = isUserMDForEvent(event);

  return `
    ${renderSongHeader(song, event, canEdit)}
    ${renderAudioPlayer(song, canEdit)}
    ${renderChordPanel(song, event, canEdit)}
    ${renderStemsPanel(song, canEdit)}
    ${renderSetlistNav(song, event)}
  `;
}

function renderSongHeader(song, event, canEdit) {
  return `
    <div class="studio-song-head" style="--song-color: ${song.color || 'var(--accent)'};">
      <div class="studio-song-head-left">
        <div class="studio-song-color-mark"></div>
        <div>
          <h1 class="studio-song-title">${esc(song.title)}</h1>
          <p class="studio-song-sub">
            ${song.artist ? `${esc(song.artist)} · ` : ''}<a href="index.html#event-${event.id}" class="studio-song-event-link">${esc(event.title)}</a>
            <span class="studio-song-event-date">· ${esc(eventDateLabel(event.date))}</span>
          </p>
        </div>
      </div>
      <div class="studio-song-head-right">
        <span class="studio-song-key-pill">Key: ${esc(song.key || '—')}</span>
        ${canEdit
          ? `<span class="studio-song-role-pill"><i data-lucide="crown"></i>MD access</span>`
          : `<span class="studio-song-role-pill view-only"><i data-lucide="eye"></i>View only</span>`
        }
      </div>
    </div>
  `;
}

// ----- AUDIO PLAYER -----
function renderAudioPlayer(song, canEdit) {
  const hasAudio = !!song.audioFile?.url;
  return `
    <div class="card studio-player-card">
      <div class="card-head">
        <div>
          <h3 class="card-title"><i data-lucide="circle-play"></i>Audio player</h3>
          <p class="card-sub">${hasAudio
            ? esc(song.audioFile.name || 'Audio file loaded')
            : 'No audio uploaded yet.'
          }</p>
        </div>
        ${canEdit ? `
          <label class="btn btn-light btn-sm" for="studioAudioFile">
            <i data-lucide="upload"></i>${hasAudio ? 'Replace' : 'Upload audio'}
            <input id="studioAudioFile" type="file" accept="audio/*" class="file-input-hidden" />
          </label>
        ` : ''}
      </div>

      ${hasAudio ? `
        <div class="studio-player">
          <div class="studio-transport">
            <button class="studio-transport-btn" id="studioRew" aria-label="Rewind 10s">
              <i data-lucide="rotate-ccw"></i>
            </button>
            <button class="studio-transport-btn primary" id="studioPlay" aria-label="Play/Pause">
              <i data-lucide="play"></i>
            </button>
            <button class="studio-transport-btn" id="studioFf" aria-label="Forward 10s">
              <i data-lucide="rotate-cw"></i>
            </button>
            <button class="studio-transport-btn ${engine.loop ? 'is-on' : ''}" id="studioLoop" aria-label="Loop">
              <i data-lucide="repeat"></i>
            </button>
          </div>

          <div class="studio-scrub">
            <span class="studio-time" id="studioCur">0:00</span>
            <input class="studio-scrub-input" id="studioScrub" type="range" min="0" max="100" step="0.1" value="0" aria-label="Scrub" />
            <span class="studio-time" id="studioDur">0:00</span>
          </div>

          <div class="studio-controls-row">
            <div class="studio-control">
              <label class="studio-control-label">
                <i data-lucide="gauge"></i>Speed
                <span class="studio-control-value" id="studioSpeedVal">${engine.speed.toFixed(2)}×</span>
              </label>
              <input class="studio-control-input" id="studioSpeed" type="range" min="0.5" max="1.5" step="0.05" value="${engine.speed}" />
              <div class="studio-control-presets">
                ${[0.5, 0.75, 1.0, 1.25].map(s => `
                  <button class="studio-preset-btn ${Math.abs(engine.speed - s) < 0.01 ? 'is-on' : ''}" data-speed="${s}">${s}×</button>
                `).join('')}
              </div>
            </div>

            <div class="studio-control">
              <label class="studio-control-label">
                <i data-lucide="music-2"></i>Pitch
                <span class="studio-control-value" id="studioPitchVal">${formatSemis(engine.semitones)}</span>
              </label>
              <input class="studio-control-input" id="studioPitch" type="range" min="-6" max="6" step="1" value="${engine.semitones}" />
              <div class="studio-control-presets">
                <button class="studio-preset-btn" data-pitch-delta="-1">−1</button>
                <button class="studio-preset-btn" data-pitch-reset>0</button>
                <button class="studio-preset-btn" data-pitch-delta="1">+1</button>
              </div>
            </div>
          </div>

          <p class="studio-engine-note" id="studioEngineNote"></p>
        </div>
      ` : `
        <div class="studio-no-audio">
          <p>${canEdit
            ? 'Upload an MP3, WAV, or M4A to enable playback controls.'
            : 'The music director has not uploaded a backing track yet.'
          }</p>
        </div>
      `}
    </div>
  `;
}

function formatSemis(n) {
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : `${n}`;
}

// ----- CHORD CHART -----
function renderChordPanel(song, event, canEdit) {
  // Live-transpose: derive the displayed chord text by shifting the raw
  // chordChart text by the current pitchShift (so audio pitch and chord
  // text move together — a 4th-flat audio plays alongside a 4th-flat chart).
  const sourceKey = song.key || '';
  const shifted = transposeText(song.chordChart || '', engine.semitones, shiftKey(sourceKey, engine.semitones));
  const shiftedKey = sourceKey ? shiftKey(sourceKey, engine.semitones) : '';

  return `
    <div class="card studio-chord-card">
      <div class="card-head">
        <div>
          <h3 class="card-title"><i data-lucide="music-2"></i>Chord chart</h3>
          <p class="card-sub">
            ${sourceKey ? `Original key: <strong>${esc(sourceKey)}</strong>` : 'No key set'}
            ${engine.semitones !== 0 ? ` · displayed in <strong>${esc(shiftedKey)}</strong> (${formatSemis(engine.semitones)})` : ''}
          </p>
        </div>
        <div class="studio-chord-tabs" role="tablist">
          ${['text', 'image', 'notes'].map(t => `
            <button class="studio-chord-tab ${ui.chordTab === t ? 'is-active' : ''}" data-chord-tab="${t}">
              ${t === 'text' ? 'Text' : t === 'image' ? 'Image/PDF' : 'Notes'}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="studio-chord-body">
        ${ui.chordTab === 'text' ? renderChordTextTab(song, canEdit, shifted) : ''}
        ${ui.chordTab === 'image' ? renderChordImageTab(song, canEdit) : ''}
        ${ui.chordTab === 'notes' ? renderChordNotesTab(song, canEdit) : ''}
      </div>
    </div>
  `;
}

function renderChordTextTab(song, canEdit, shifted) {
  const hasChart = !!(song.chordChart && song.chordChart.trim());
  return `
    ${hasChart ? `
      <pre class="studio-chord-display">${esc(shifted)}</pre>
    ` : canEdit ? `
      <p class="studio-chord-empty">No chord chart yet. ${canEdit ? 'Click "Edit chords" below to add one.' : ''}</p>
    ` : `
      <p class="studio-chord-empty">The music director hasn't added a chord chart for this song.</p>
    `}
    ${canEdit ? `
      <div class="studio-chord-foot">
        <button class="btn btn-light btn-sm" id="studioEditChords">
          <i data-lucide="pen-line"></i>${hasChart ? 'Edit chords' : 'Add chord chart'}
        </button>
        ${hasChart && engine.semitones !== 0 ? `
          <button class="btn btn-light btn-sm" id="studioCommitTranspose" title="Save the transposed chords as the new chord chart">
            <i data-lucide="save"></i>Save transposed
          </button>
        ` : ''}
      </div>
    ` : ''}
  `;
}

function renderChordImageTab(song, canEdit) {
  const img = song.chordChartImage;
  return `
    ${img?.url ? `
      <div class="studio-chord-image-wrap">
        ${(img.name || '').toLowerCase().endsWith('.pdf')
          ? `<embed src="${esc(img.url)}" type="application/pdf" class="studio-chord-pdf" />`
          : `<img src="${esc(img.url)}" alt="${esc(img.name || 'Chord chart')}" class="studio-chord-image" />`
        }
      </div>
    ` : `
      <p class="studio-chord-empty">No image or PDF uploaded.</p>
    `}
    ${canEdit ? `
      <div class="studio-chord-foot">
        <label class="btn btn-light btn-sm" for="studioChartFile">
          <i data-lucide="upload"></i>${img?.url ? 'Replace' : 'Upload image/PDF'}
          <input id="studioChartFile" type="file" accept="image/*,application/pdf" class="file-input-hidden" />
        </label>
        ${img?.url ? `
          <button class="btn btn-danger btn-sm" id="studioDeleteChart">
            <i data-lucide="trash-2"></i>Remove
          </button>
        ` : ''}
      </div>
    ` : ''}
  `;
}

function renderChordNotesTab(song, canEdit) {
  return `
    ${canEdit ? `
      <textarea class="studio-chord-notes-input"
                id="studioNotes"
                placeholder="e.g. Watch the key change at the bridge. Drums drop out on verse 2. Hold the last chord for 8 counts."
                rows="6">${esc(song.mdNotes || '')}</textarea>
      <p class="studio-notes-hint"><i data-lucide="info"></i>Notes save when you click outside the box.</p>
    ` : `
      ${song.mdNotes ? `
        <p class="studio-chord-notes-display">${esc(song.mdNotes).replace(/\n/g, '<br>')}</p>
      ` : `
        <p class="studio-chord-empty">No notes from the music director yet.</p>
      `}
    `}
  `;
}

// ----- STEMS PANEL -----
function renderStemsPanel(song, canEdit) {
  const stems = song.stems || {};
  const hasAny = Object.keys(stems).some(k => stems[k]?.url);

  return `
    <div class="card studio-stems-card">
      <div class="card-head">
        <div>
          <h3 class="card-title"><i data-lucide="layers"></i>Stem splitter</h3>
          <p class="card-sub">Practice with just one instrument at a time.</p>
        </div>
        ${canEdit ? `
          <a class="btn btn-primary btn-sm" href="https://www.lalal.ai/" target="_blank" rel="noopener noreferrer">
            <i data-lucide="external-link"></i>Open LALAL.AI
          </a>
        ` : ''}
      </div>

      <div class="studio-stems-body">
        <p class="studio-stems-blurb">
          ${canEdit
            ? 'To get isolated tracks (vocals only, drums only, etc), upload your audio to LALAL.AI or a similar tool, then upload each separated stem below.'
            : 'When the music director uploads separated stems, you will be able to play them individually here.'
          }
        </p>
        <div class="studio-stems-grid">
          ${['vocals', 'drums', 'bass', 'other'].map(kind => {
            const s = stems[kind];
            const has = !!s?.url;
            return `
              <div class="studio-stem-slot ${has ? 'has-stem' : ''}">
                <div class="studio-stem-slot-icon">
                  <i data-lucide="${kind === 'vocals' ? 'mic-2' : kind === 'drums' ? 'drum' : kind === 'bass' ? 'audio-lines' : 'guitar'}"></i>
                </div>
                <div class="studio-stem-slot-body">
                  <p class="studio-stem-slot-name">${kind[0].toUpperCase()}${kind.slice(1)}</p>
                  ${has
                    ? `<audio controls preload="none" src="${esc(s.url)}" class="studio-stem-audio"></audio>`
                    : `<p class="studio-stem-slot-empty">Not uploaded</p>`
                  }
                </div>
                ${canEdit ? `
                  <label class="studio-stem-slot-upload" for="studioStem-${kind}" title="Upload ${kind} stem">
                    <i data-lucide="upload"></i>
                    <input id="studioStem-${kind}" type="file" accept="audio/*" class="file-input-hidden" data-stem-kind="${kind}" />
                  </label>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

// ----- SETLIST NAV -----
function renderSetlistNav(song, event) {
  const setlist = event.setlist || [];
  const idx = setlist.findIndex(s => s.id === song.id);
  const prev = idx > 0 ? setlist[idx - 1] : null;
  const next = idx < setlist.length - 1 ? setlist[idx + 1] : null;

  return `
    <div class="studio-setlist-nav">
      <button class="studio-nav-btn" ${prev ? `data-go-song="${esc(prev.id)}"` : 'disabled'}>
        <i data-lucide="chevron-left"></i>
        <span>
          <span class="studio-nav-label">Previous</span>
          ${prev ? `<span class="studio-nav-title">${esc(prev.title)}</span>` : '<span class="studio-nav-empty">—</span>'}
        </span>
      </button>
      <div class="studio-nav-counter">
        ${setlist.length > 0 ? `${idx + 1} / ${setlist.length}` : '—'}
        <span class="studio-nav-counter-sub">in setlist</span>
      </div>
      <button class="studio-nav-btn studio-nav-btn-right" ${next ? `data-go-song="${esc(next.id)}"` : 'disabled'}>
        <span>
          <span class="studio-nav-label">Next</span>
          ${next ? `<span class="studio-nav-title">${esc(next.title)}</span>` : '<span class="studio-nav-empty">—</span>'}
        </span>
        <i data-lucide="chevron-right"></i>
      </button>
    </div>
  `;
}

// ============================================================
// RENDER ROOT
// ============================================================
function render() {
  const root = $('#page');
  root.innerHTML = `
    <div class="studio-layout">
      <aside class="studio-side">
        <div class="studio-side-head">
          <h2 class="studio-side-title">All songs</h2>
          <p class="studio-side-sub">Across every event</p>
        </div>
        <div class="studio-side-list">
          ${renderSongList()}
        </div>
      </aside>
      <section class="studio-main">
        ${renderWorkspace()}
      </section>
    </div>
  `;

  bindAll();
  if (window.lucide) window.lucide.createIcons();
}

// ============================================================
// AUDIO ENGINE — <audio> primary, Tone.PitchShift layered for pitch
// ============================================================

// Create (once) the shared <audio> element and wire up its events.
function ensureAudioEl() {
  if (engine.el) return engine.el;
  const el = new Audio();
  el.preload = 'metadata';
  el.addEventListener('timeupdate', updateScrub);
  el.addEventListener('loadedmetadata', () => { updateDurationLabel(); updateScrub(); });
  el.addEventListener('play', () => onPlayStateChanged(true));
  el.addEventListener('pause', () => onPlayStateChanged(false));
  el.addEventListener('ended', () => { if (!el.loop) onPlayStateChanged(false); });
  engine.el = el;
  return el;
}

// Point the <audio> element at the active song (if not already loaded).
function loadAudioForActiveSong() {
  const ctx = getActiveSong();
  if (!ctx?.song?.audioFile?.url) return;
  const url = ctx.song.audioFile.url;
  const el = ensureAudioEl();
  if (engine.currentSongUrl === url) return;
  el.src = url;
  el.playbackRate = engine.speed;
  el.loop = engine.loop;
  engine.currentSongUrl = url;
}

// Lazily load Tone + insert the pitch-shift node into the <audio> output
// graph. Called the first time the user changes pitch (so chord-only
// visitors never download Tone). Returns true on success.
let _pitchEnginePromise = null;
async function ensurePitchEngine() {
  if (engine.toneLoaded) return true;
  if (engine.toneFailed) return false;
  if (_pitchEnginePromise) return _pitchEnginePromise;   // coalesce concurrent calls
  _pitchEnginePromise = (async () => {
    try {
      const TonePkg = await import('https://cdn.jsdelivr.net/npm/tone@14.8.49/+esm');
      engine.Tone = TonePkg;
      // Share Tone's AudioContext so MediaElementSource and PitchShift agree.
      engine.ctx = TonePkg.getContext().rawContext;

      const el = ensureAudioEl();
      // Web Audio can only read a cross-origin media stream if the element is
      // marked crossOrigin AND the host sends CORS headers. Supabase Storage
      // sends them by default, so this just works — we set crossOrigin and
      // reload so the next fetch is a proper CORS request.
      if (!el.crossOrigin) {
        const wasPlaying = !el.paused;
        const pos = el.currentTime;
        el.crossOrigin = 'anonymous';
        if (engine.currentSongUrl) {
          el.src = engine.currentSongUrl;
          el.load();
          el.addEventListener('canplay', function once() {
            el.removeEventListener('canplay', once);
            try { el.currentTime = pos; } catch (_) {}
            if (wasPlaying) el.play().catch(() => {});
          });
        }
      }

      // A media element can only ever have ONE MediaElementSourceNode.
      engine.mediaSource = engine.ctx.createMediaElementSource(el);

      engine.pitchNode = new TonePkg.PitchShift({ pitch: engine.semitones });
      TonePkg.connect(engine.mediaSource, engine.pitchNode);
      engine.pitchNode.toDestination();
      engine.routed = true;
      engine.toneLoaded = true;
      setEngineNote('');
      return true;
    } catch (e) {
      console.warn('[Studio] pitch engine unavailable; speed-only mode', e);
      engine.toneFailed = true;
      setEngineNote('Pitch shift unavailable in this browser — speed control still works.');
      return false;
    }
  })();
  return _pitchEnginePromise;
}

function setEngineNote(text) {
  const el = $('#studioEngineNote');
  if (el) el.textContent = text || '';
}

// ----- transport -----
async function togglePlay() {
  loadAudioForActiveSong();
  const el = engine.el;
  if (!el) return;
  if (el.paused) {
    // Resume the AudioContext if the pitch graph is active (autoplay policy)
    if (engine.ctx && engine.ctx.state === 'suspended') {
      try { await engine.ctx.resume(); } catch (_) {}
    }
    try { await el.play(); }
    catch (e) { showToast('Could not play audio', true); console.warn(e); }
  } else {
    el.pause();
  }
}

function isPlaying() {
  return engine.el && !engine.el.paused;
}

function onPlayStateChanged(playing) {
  const btn = $('#studioPlay');
  if (!btn) return;
  btn.innerHTML = playing ? '<i data-lucide="pause"></i>' : '<i data-lucide="play"></i>';
  if (window.lucide) window.lucide.createIcons();
}

function seekBy(delta) {
  const el = engine.el;
  if (!el) return;
  const dur = el.duration || 0;
  el.currentTime = Math.max(0, Math.min(dur, el.currentTime + delta));
}

function setSpeed(value) {
  engine.speed = value;
  if (engine.el) engine.el.playbackRate = value;
  const out = $('#studioSpeedVal');
  if (out) out.textContent = `${value.toFixed(2)}×`;
  $$('[data-speed]').forEach(b => {
    b.classList.toggle('is-on', Math.abs(parseFloat(b.dataset.speed) - value) < 0.01);
  });
}

async function setPitch(semis) {
  engine.semitones = semis;
  // Spin up the pitch engine on first use
  if (semis !== 0 && !engine.toneLoaded && !engine.toneFailed) {
    await ensurePitchEngine();
  }
  if (engine.pitchNode) engine.pitchNode.pitch = semis;

  const out = $('#studioPitchVal');
  if (out) out.textContent = formatSemis(semis);
  const slider = $('#studioPitch');
  if (slider && parseInt(slider.value) !== semis) slider.value = String(semis);

  // Re-render only the chord card so the transposed display tracks the
  // pitch, without tearing down the player (which would stop playback).
  refreshChordCard();
}

function toggleLoop() {
  engine.loop = !engine.loop;
  if (engine.el) engine.el.loop = engine.loop;
  const btn = $('#studioLoop');
  if (btn) btn.classList.toggle('is-on', engine.loop);
}

// ----- progress / scrub -----
function getCurrentTime() { return engine.el?.currentTime || 0; }
function getDuration() { return engine.el?.duration || 0; }

function updateScrub() {
  const cur = getCurrentTime();
  const dur = getDuration();
  const scrub = $('#studioScrub');
  const curLabel = $('#studioCur');
  if (curLabel) curLabel.textContent = fmtTime(cur);
  if (scrub && dur > 0 && document.activeElement !== scrub) {
    scrub.value = String((cur / dur) * 100);
  }
}

function updateDurationLabel() {
  const lab = $('#studioDur');
  if (lab) lab.textContent = fmtTime(getDuration());
}

// ============================================================
// CHORD CARD REFRESH (without nuking the whole page)
// ============================================================
function refreshChordCard() {
  const card = $('.studio-chord-card');
  if (!card) return;
  const ctx = getActiveSong();
  if (!ctx) return;
  const canEdit = isUserMDForEvent(ctx.event);
  card.outerHTML = renderChordPanel(ctx.song, ctx.event, canEdit);
  if (window.lucide) window.lucide.createIcons();
  bindChordPanel(); // re-bind handlers on the new DOM
}

// ============================================================
// BINDINGS
// ============================================================
function bindAll() {
  // Sidebar: click a song
  $$('[data-song-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      setActiveSong(btn.dataset.songId);
    });
  });

  // Search
  const search = $('#studioSearch');
  if (search) {
    search.value = ui.search;
    search.addEventListener('input', () => {
      ui.search = search.value;
      // Only the sidebar changes — don't re-render the whole workspace
      const listEl = $('.studio-side-list');
      if (listEl) {
        listEl.innerHTML = renderSongList();
        if (window.lucide) window.lucide.createIcons();
        $$('.studio-side-list [data-song-id]').forEach(b => {
          b.addEventListener('click', () => setActiveSong(b.dataset.songId));
        });
      }
    });
  }

  bindPlayer();
  bindChordPanel();
  bindStems();
  bindSetlistNav();
}

function bindPlayer() {
  $('#studioPlay')?.addEventListener('click', togglePlay);
  $('#studioRew')?.addEventListener('click', () => seekBy(-10));
  $('#studioFf')?.addEventListener('click', () => seekBy(10));
  $('#studioLoop')?.addEventListener('click', toggleLoop);

  const scrub = $('#studioScrub');
  if (scrub) {
    scrub.addEventListener('input', () => {
      const dur = getDuration();
      if (!dur) return;
      const t = (parseFloat(scrub.value) / 100) * dur;
      if (engine.el) engine.el.currentTime = t;
      const lab = $('#studioCur');
      if (lab) lab.textContent = fmtTime(t);
    });
  }

  const speedSlider = $('#studioSpeed');
  if (speedSlider) {
    speedSlider.addEventListener('input', () => setSpeed(parseFloat(speedSlider.value)));
  }
  $$('[data-speed]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = parseFloat(btn.dataset.speed);
      const slider = $('#studioSpeed');
      if (slider) slider.value = String(v);
      setSpeed(v);
    });
  });

  const pitchSlider = $('#studioPitch');
  if (pitchSlider) {
    pitchSlider.addEventListener('input', () => setPitch(parseInt(pitchSlider.value)));
  }
  $$('[data-pitch-delta]').forEach(btn => {
    btn.addEventListener('click', () => {
      const delta = parseInt(btn.dataset.pitchDelta);
      const next = Math.max(-6, Math.min(6, engine.semitones + delta));
      setPitch(next);
    });
  });
  $('[data-pitch-reset]')?.addEventListener('click', () => setPitch(0));

  // Audio upload
  const fileInput = $('#studioAudioFile');
  if (fileInput) {
    fileInput.addEventListener('change', () => handleAudioUpload(fileInput.files[0]));
  }

  // Tone needs to be primed on the first user gesture. We do it here so
  // that pitch shift is ready by the time someone moves the slider.
  // (Calling Tone.start() outside a user gesture throws.)
}

function bindChordPanel() {
  // Tabs
  $$('[data-chord-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      ui.chordTab = btn.dataset.chordTab;
      refreshChordCard();
    });
  });

  // Edit chords (modal)
  $('#studioEditChords')?.addEventListener('click', openEditChordsModal);

  // Save the currently-transposed chord text as the new chordChart
  $('#studioCommitTranspose')?.addEventListener('click', commitTranspose);

  // Notes save on blur
  const notes = $('#studioNotes');
  if (notes) {
    notes.addEventListener('blur', () => {
      const ctx = getActiveSong();
      if (!ctx) return;
      updateSong(ctx.event.id, ctx.song.id, { mdNotes: notes.value });
      showToast('Notes saved');
    });
  }

  // Chord chart image upload / delete
  const chartFile = $('#studioChartFile');
  if (chartFile) {
    chartFile.addEventListener('change', () => handleChartUpload(chartFile.files[0]));
  }
  $('#studioDeleteChart')?.addEventListener('click', handleChartDelete);
}

function bindStems() {
  $$('[data-stem-kind]').forEach(input => {
    input.addEventListener('change', () => handleStemUpload(input.dataset.stemKind, input.files[0]));
  });
}

function bindSetlistNav() {
  $$('[data-go-song]').forEach(btn => {
    btn.addEventListener('click', () => setActiveSong(btn.dataset.goSong));
  });
}

// ============================================================
// ACTIONS
// ============================================================
function setActiveSong(songId) {
  if (ui.activeSongId === songId) return;
  // Stop playback before swapping songs
  if (engine.el && !engine.el.paused) {
    try { engine.el.pause(); } catch (_) {}
  }
  // Force the next play to (re)load the new song's audio
  engine.currentSongUrl = null;
  if (engine.el) { try { engine.el.removeAttribute('src'); engine.el.load(); } catch (_) {} }

  ui.activeSongId = songId;
  // Sync URL so deep-links work
  const url = new URL(window.location);
  url.searchParams.set('song', songId);
  window.history.replaceState(null, '', url.toString());
  render();
}

async function handleAudioUpload(file) {
  if (!file) return;
  const ctx = getActiveSong();
  if (!ctx) return;
  if (!isUserMDForEvent(ctx.event)) {
    showToast('Only the Music Director can upload audio', true);
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    showToast(`File too large (${formatBytes(file.size)}). Limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`, true);
    return;
  }
  if (!file.type.startsWith('audio/')) {
    showToast('Please pick an audio file', true);
    return;
  }

  ui.uploadingAudio = true;
  showToast(`Uploading "${file.name}"…`);

  try {
    // Delete the previous file (if any) before uploading the new one,
    // so we don't leave orphans in storage.
    if (ctx.song.audioFile?.path) {
      try { await deleteFile(ctx.song.audioFile.path); } catch (_) {}
    }

    const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
    const path = `songs/${ctx.event.id}/${ctx.song.id}/audio.${ext}`;
    const { url } = await uploadFile(path, file);
    // Cache-bust: the storage path is reused across replacements, so the
    // public URL is identical each time and the browser/CDN would serve the
    // stale file. A version query param forces a fresh fetch.
    const bustedUrl = `${url}?v=${Date.now()}`;
    updateSong(ctx.event.id, ctx.song.id, {
      audioFile: { name: file.name, size: file.size, type: file.type, url: bustedUrl, path },
    });
    // Force the player to reload the new file (otherwise loadAudioForActiveSong
    // sees a "different" url only because of the query param and reloads — but
    // we clear currentSongUrl to be certain, and stop any current playback).
    if (engine.el) { try { engine.el.pause(); } catch (_) {} }
    engine.currentSongUrl = null;
    showToast('Audio uploaded');
    render();
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Upload failed', true);
  } finally {
    ui.uploadingAudio = false;
  }
}

async function handleChartUpload(file) {
  if (!file) return;
  const ctx = getActiveSong();
  if (!ctx) return;
  if (!isUserMDForEvent(ctx.event)) {
    showToast('Only the Music Director can upload', true);
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    showToast(`File too large (${formatBytes(file.size)}).`, true);
    return;
  }
  const isImg = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf';
  if (!isImg && !isPdf) {
    showToast('Please pick an image or PDF', true);
    return;
  }

  showToast(`Uploading "${file.name}"…`);
  try {
    if (ctx.song.chordChartImage?.path) {
      try { await deleteFile(ctx.song.chordChartImage.path); } catch (_) {}
    }
    const ext = (file.name.split('.').pop() || (isPdf ? 'pdf' : 'png')).toLowerCase();
    const path = `songs/${ctx.event.id}/${ctx.song.id}/chart.${ext}`;
    const { url } = await uploadFile(path, file);
    updateSong(ctx.event.id, ctx.song.id, {
      chordChartImage: { name: file.name, url: `${url}?v=${Date.now()}`, path },
    });
    showToast('Chord chart uploaded');
    refreshChordCard();
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Upload failed', true);
  }
}

async function handleChartDelete() {
  const ctx = getActiveSong();
  if (!ctx || !ctx.song.chordChartImage) return;
  if (!isUserMDForEvent(ctx.event)) return;
  try {
    if (ctx.song.chordChartImage.path) await deleteFile(ctx.song.chordChartImage.path);
  } catch (_) {}
  updateSong(ctx.event.id, ctx.song.id, { chordChartImage: null });
  showToast('Chord chart removed');
  refreshChordCard();
}

async function handleStemUpload(kind, file) {
  if (!file) return;
  const ctx = getActiveSong();
  if (!ctx) return;
  if (!isUserMDForEvent(ctx.event)) {
    showToast('Only the Music Director can upload', true);
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    showToast(`File too large (${formatBytes(file.size)}).`, true);
    return;
  }
  if (!file.type.startsWith('audio/')) {
    showToast('Please pick an audio file', true);
    return;
  }
  showToast(`Uploading ${kind} stem…`);
  try {
    const existing = ctx.song.stems?.[kind]?.path;
    if (existing) {
      try { await deleteFile(existing); } catch (_) {}
    }
    const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
    const path = `songs/${ctx.event.id}/${ctx.song.id}/stem-${kind}.${ext}`;
    const { url } = await uploadFile(path, file);
    const newStems = { ...(ctx.song.stems || {}), [kind]: { url: `${url}?v=${Date.now()}`, path, name: file.name } };
    updateSong(ctx.event.id, ctx.song.id, { stems: newStems });
    showToast(`${kind[0].toUpperCase()}${kind.slice(1)} stem uploaded`);
    render();
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Upload failed', true);
  }
}

function openEditChordsModal() {
  const ctx = getActiveSong();
  if (!ctx) return;
  const { event, song } = ctx;
  if (!isUserMDForEvent(event)) return;

  const content = `
    <div class="modal-head">
      <div class="modal-icon accent"><i data-lucide="music-2"></i></div>
      <div>
        <h3 class="modal-title">Chord chart — ${esc(song.title)}</h3>
        <p class="modal-sub">Paste or type the chord chart. Chord names are detected automatically.</p>
      </div>
      <button class="modal-close" data-close-modal><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <label class="modal-label">Chord chart (key: ${esc(song.key || '—')})</label>
        <textarea class="modal-textarea" id="editChordsArea" rows="14" placeholder="Verse 1:&#10;G       D         Em        C&#10;Amazing grace, how sweet the sound...">${esc(song.chordChart || '')}</textarea>
        <p class="modal-help">Tip: any standard chord notation works — G, Em, C/E, F#m7, Bbsus4, etc. Transpose later with the up/down arrows.</p>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-light" data-close-modal>Cancel</button>
      <button class="btn btn-primary" id="confirmChords">
        <i data-lucide="save"></i>Save chords
      </button>
    </div>
  `;

  openModal(content, {
    wide: true,
    onBind: (modal) => {
      $('#editChordsArea', modal).focus();
      $('#confirmChords', modal).addEventListener('click', () => {
        const text = $('#editChordsArea', modal).value;
        updateSong(event.id, song.id, { chordChart: text });
        closeModal();
        refreshChordCard();
        showToast('Chord chart saved');
      });
    },
  });
}

function commitTranspose() {
  const ctx = getActiveSong();
  if (!ctx) return;
  const { event, song } = ctx;
  if (!isUserMDForEvent(event)) return;
  const sourceKey = song.key || '';
  const newText = transposeText(song.chordChart || '', engine.semitones, shiftKey(sourceKey, engine.semitones));
  const newKey = sourceKey ? shiftKey(sourceKey, engine.semitones) : sourceKey;
  updateSong(event.id, song.id, { chordChart: newText, key: newKey });
  // Reset the pitch shift so the displayed key matches the new source key
  setPitch(0);
  showToast(`Saved in ${newKey}`);
}

// ============================================================
// BOOT
// ============================================================
(async () => {
  await initShell();

  // Open the song specified by ?song= if present (deep-link from My Schedules)
  const params = new URLSearchParams(location.search);
  const songParam = params.get('song');
  if (songParam) {
    const hit = findSongById(songParam);
    if (hit) ui.activeSongId = songParam;
  }

  // Otherwise pick the first available song so the workspace isn't empty
  if (!ui.activeSongId) {
    for (const ev of events) {
      if (ev.setlist && ev.setlist.length > 0) {
        ui.activeSongId = ev.setlist[0].id;
        break;
      }
    }
  }

  render();

  // Live updates — if the MD adds a song or uploads audio while we're here,
  // we want to see it. Skip while a modal is open or audio is playing
  // (re-render would interrupt playback).
  onDataChange(() => {
    if (document.getElementById('modalRoot')) return;
    if (isPlaying()) return;
    // Skip if the user is typing in the notes field
    const ae = document.activeElement;
    if (ae && ae.id === 'studioNotes') return;
    if (ae && ae.id === 'editChordsArea') return;
    render();
  });
})();
