const dropzone  = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const results   = document.getElementById('results');

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
});
fileInput.addEventListener('change', e => { if (e.target.files[0]) processFile(e.target.files[0]); });

function processFile(file) {
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const raw = new Uint8Array(ev.target.result);
      const decompressed = await decompressGzip(raw);
      const text = new TextDecoder().decode(decompressed);
      const parser = new DOMParser();
      const xml = parser.parseFromString(text, 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('XML parse error');
      render(analyse(xml, file.name));
    } catch(err) {
      results.innerHTML = `<div style="color:#f54242;padding:20px">Error: ${err.message}<br><small>Make sure this is a valid .als file saved by Ableton Live.</small></div>`;
      results.classList.add('visible');
    }
  };
  reader.readAsArrayBuffer(file);
}

async function decompressGzip(data) {
  const ds = new DecompressionStream('gzip');
  const w  = ds.writable.getWriter();
  const r  = ds.readable.getReader();
  const chunks = [];
  w.write(data);
  w.close();
  while (true) {
    const { done, value } = await r.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n,c) => n+c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

/* ─────────────────────────────────────────
   ANALYSIS
───────────────────────────────────────── */
function analyse(xml, filename) {
  const d = {};

  // ── Project name
  d.filename = filename.replace(/\.als$/i, '');

  // ── BPM + time sig
  const tempo = xml.querySelector('Tempo > Manual');
  d.bpm = tempo ? parseFloat(tempo.getAttribute('Value')).toFixed(1) : '—';
  const tsNum = xml.querySelector('TimeSignature TimeSignatures AutomationEvent');
  if (tsNum) {
    const num = tsNum.getAttribute('Numerator');
    const den = tsNum.getAttribute('Denominator');
    d.timeSig = num && den ? `${num}/${den}` : '4/4';
  } else {
    d.timeSig = '4/4';
  }

  // ── Live version
  const creator = xml.querySelector('Ableton');
  d.liveVersion = creator ? (creator.getAttribute('Creator') || 'Unknown').replace('Ableton Live ', '') : '—';

  // ── Track types
  const audioTracks  = [...xml.querySelectorAll('AudioTrack')];
  const midiTracks   = [...xml.querySelectorAll('MidiTrack')];
  const groupTracks  = [...xml.querySelectorAll('GroupTrack')];
  const returnTracks = [...xml.querySelectorAll('ReturnTrack')];
  const masterTrack  = [...xml.querySelectorAll('MasterTrack')];

  d.audioCount  = audioTracks.length;
  d.midiCount   = midiTracks.length;
  d.groupCount  = groupTracks.length;
  d.returnCount = returnTracks.length;
  d.totalTracks = audioTracks.length + midiTracks.length + groupTracks.length + returnTracks.length;

  // ── Clips
  let clipCount = 0;
  xml.querySelectorAll('MidiClip, AudioClip').forEach(() => clipCount++);
  d.clipCount = clipCount;

  // ── Frozen tracks
  const frozenTracks = [];
  [...audioTracks, ...midiTracks, ...groupTracks].forEach(t => {
    const freeze = t.querySelector('Freeze');
    if (freeze && freeze.getAttribute('Value') === 'true') {
      const name = getTrackName(t);
      frozenTracks.push(name);
    }
  });
  d.frozenTracks = frozenTracks;

  // ── Per-track device info
  const allTracks = [
    ...audioTracks.map(t => ({el:t, type:'Audio'})),
    ...midiTracks.map(t => ({el:t, type:'MIDI'})),
    ...groupTracks.map(t => ({el:t, type:'Group'})),
    ...returnTracks.map(t => ({el:t, type:'Return'})),
    ...masterTrack.map(t => ({el:t, type:'Master'})),
  ];

  const pluginCounts   = {}; // name -> {count, kind}
  const nativeDevices  = {}; // name -> count
  const trackDetails   = [];
  const emptyChains    = [];

  allTracks.forEach(({el, type}) => {
    const name    = type === 'Master' ? 'Master' : getTrackName(el);
    const frozen  = el.querySelector('Freeze')?.getAttribute('Value') === 'true';
    const devices = [];

    // VST2
    el.querySelectorAll('PluginDevice').forEach(pd => {
      const pn = pd.querySelector('PlugName');
      const plugName = pn ? pn.getAttribute('Value') : 'Unknown VST2';
      devices.push({ name: plugName, kind: 'VST2' });
      if (!pluginCounts[plugName]) pluginCounts[plugName] = { count: 0, kind: 'VST2' };
      pluginCounts[plugName].count++;
    });

    // VST3
    el.querySelectorAll('Vst3PluginDevice').forEach(pd => {
      const pn = pd.querySelector('Name') || pd.querySelector('PlugName');
      const plugName = pn ? pn.getAttribute('Value') : 'Unknown VST3';
      devices.push({ name: plugName, kind: 'VST3' });
      if (!pluginCounts[plugName]) pluginCounts[plugName] = { count: 0, kind: 'VST3' };
      pluginCounts[plugName].count++;
    });

    // AU
    el.querySelectorAll('AuPluginDevice').forEach(pd => {
      const pn = pd.querySelector('Name') || pd.querySelector('PlugName');
      const plugName = pn ? pn.getAttribute('Value') : 'Unknown AU';
      devices.push({ name: plugName, kind: 'AU' });
      if (!pluginCounts[plugName]) pluginCounts[plugName] = { count: 0, kind: 'AU' };
      pluginCounts[plugName].count++;
    });

    // Max for Live
    el.querySelectorAll('MaxDevice').forEach(pd => {
      const pn = pd.querySelector('Name') || pd.querySelector('UserName');
      const plugName = pn ? pn.getAttribute('Value') : 'M4L Device';
      devices.push({ name: plugName, kind: 'M4L' });
      if (!pluginCounts[plugName]) pluginCounts[plugName] = { count: 0, kind: 'M4L' };
      pluginCounts[plugName].count++;
    });

    // Native Ableton devices (heuristic: known tags)
    const nativeTags = [
      'Operator','Sampler','Simpler','Drum Rack','InstrumentGroupDevice',
      'AudioEffectGroupDevice','MidiEffectGroupDevice',
      'Eq8','Compressor2','AutoFilter','Reverb','Delay','GlueCompressor',
      'MultibandDynamics','Limiter','Gate','Saturator','Erosion',
      'Corpus','DrumSynth','Collision','Redux','Vinyl Distortion',
      'PitchTwo','Drift','Meld','Roar','Shifter',
      'FilterDelay','GrainDelay','Looper','BeatRepeat',
      'Chord','Arpeggiator','Velocity','Scale','Note Length',
      'MidiEffectRack','AutoPan','Phaser','Flanger',
      'Echo', 'Spectral Resonator', 'Spectral Blur', 'Convolution Reverb',
    ];
    const nativeTagMap = {
      'Eq8':'EQ Eight', 'Compressor2':'Compressor', 'AutoFilter':'Auto Filter',
      'InstrumentGroupDevice':'Instrument Rack','AudioEffectGroupDevice':'Audio Effect Rack',
      'MidiEffectGroupDevice':'MIDI Effect Rack','PitchTwo':'Pitch',
    };
    nativeTags.forEach(tag => {
      const cleanTag = tag.replace(/ /g,'');
      el.querySelectorAll(cleanTag).forEach(() => {
        const displayName = nativeTagMap[tag] || tag;
        if (!nativeDevices[displayName]) nativeDevices[displayName] = 0;
        nativeDevices[displayName]++;
        devices.push({ name: displayName, kind: 'native' });
      });
    });

    if (type !== 'Master' && devices.length === 0) emptyChains.push(name);

    trackDetails.push({ name, type, frozen, devices });
  });

  d.pluginCounts  = pluginCounts;
  d.nativeDevices = nativeDevices;
  d.trackDetails  = trackDetails;
  d.emptyChains   = emptyChains;

  // ── Totals
  d.totalPluginInstances = Object.values(pluginCounts).reduce((s,v) => s+v.count, 0);
  d.uniquePlugins        = Object.keys(pluginCounts).length;

  return d;
}

function getTrackName(el) {
  const en = el.querySelector('Name > EffectiveName');
  return en ? en.getAttribute('Value') : 'Unnamed';
}

/* ─────────────────────────────────────────
   RENDER
───────────────────────────────────────── */
function render(d) {
  const totalForBar = d.audioCount + d.midiCount + d.groupCount + d.returnCount;
  const pct = n => totalForBar ? (n/totalForBar*100).toFixed(1) : 0;

  // ── Plugin table rows
  const sortedPlugins = Object.entries(d.pluginCounts).sort((a,b) => b[1].count - a[1].count);
  const maxCount = sortedPlugins.length ? sortedPlugins[0][1].count : 1;

  const pluginRows = sortedPlugins.map(([name, {count, kind}]) => {
    const tag = `<span class="plugin-type tag-${kind.toLowerCase()}">${kind}</span>`;
    const barW = Math.round(count/maxCount*80);
    return `<tr>
      <td><span class="plugin-name">${esc(name)}</span>${tag}</td>
      <td>
        <div class="count-bar-wrap">
          <div class="count-bar" style="width:${barW}px"><div class="count-bar-fill" style="width:100%"></div></div>
          <span class="plugin-count">${count}</span>
        </div>
      </td>
    </tr>`;
  }).join('');

  // ── Native device rows
  const sortedNative = Object.entries(d.nativeDevices).sort((a,b) => b[1]-a[1]);
  const maxNative = sortedNative.length ? sortedNative[0][1] : 1;
  const nativeRows = sortedNative.map(([name, count]) => {
    const barW = Math.round(count/maxNative*80);
    return `<tr>
      <td><span class="plugin-name">${esc(name)}</span></td>
      <td>
        <div class="count-bar-wrap">
          <div class="count-bar" style="width:${barW}px"><div class="count-bar-fill" style="width:100%;background:var(--accent2)"></div></div>
          <span class="plugin-count">${count}</span>
        </div>
      </td>
    </tr>`;
  }).join('');

  // ── Track list
  const trackRows = d.trackDetails.map((t, i) => {
    const chips = [...new Map(t.devices.map(d => [d.name, d])).values()].map(dev => {
      const cls = dev.kind === 'native' ? '' : dev.kind === 'M4L' ? 'is-m4l' : 'is-plugin';
      return `<span class="device-chip ${cls}">${esc(dev.name)}</span>`;
    }).join('');
    const frozenBadge = t.frozen ? `<span class="track-frozen">❄ frozen</span>` : '';
    const emptyBadge  = t.type !== 'Master' && t.devices.length === 0 ? `<span class="track-no-fx">no devices</span>` : '';
    return `<div class="track-row">
      <span class="track-index">${String(i+1).padStart(2,'0')}</span>
      <div class="track-info">
        <div class="track-info-name">${esc(t.name)}${frozenBadge}${emptyBadge}</div>
        <div class="track-devices">${chips || '<span class="no-data">—</span>'}</div>
      </div>
      <span class="type-badge">${t.type}</span>
    </div>`;
  }).join('');

  // ── Flags / observations
  const flags = [];
  if (d.frozenTracks.length)
    flags.push(`<div class="flag flag-info">❄ ${d.frozenTracks.length} frozen track${d.frozenTracks.length>1?'s':''}: ${d.frozenTracks.map(esc).join(', ')}</div>`);
  if (d.emptyChains.length)
    flags.push(`<div class="flag flag-warn">⚠ ${d.emptyChains.length} track${d.emptyChains.length>1?'s':''} with no devices: ${d.emptyChains.map(esc).join(', ')}</div>`);
  if (d.totalPluginInstances > 40)
    flags.push(`<div class="flag flag-warn">⚠ High plugin count (${d.totalPluginInstances} instances) — may be CPU intensive</div>`);
  if (d.totalPluginInstances === 0)
    flags.push(`<div class="flag flag-good">✓ No third-party plugins — fully portable project</div>`);
  if (d.returnCount === 0)
    flags.push(`<div class="flag flag-info">ℹ No return tracks found</div>`);
  if (d.groupCount > 0)
    flags.push(`<div class="flag flag-good">✓ ${d.groupCount} group track${d.groupCount>1?'s':''} — good signal chain organisation</div>`);

  results.innerHTML = `
    <div class="project-header">
      <div class="project-name">${esc(d.filename)}</div>
      <div class="project-meta">
        <div class="meta-item accent">
          <span class="meta-item-value">${d.bpm}</span>
          <span class="meta-item-label">BPM</span>
        </div>
        <div class="meta-item accent2">
          <span class="meta-item-value">${d.timeSig}</span>
          <span class="meta-item-label">Time Sig</span>
        </div>
        <div class="meta-item accent3">
          <span class="meta-item-value">${d.clipCount}</span>
          <span class="meta-item-label">Clips</span>
        </div>
        <div class="meta-item">
          <span class="meta-item-label">Live</span>
          <span class="meta-item-value" style="font-size:15px">${esc(d.liveVersion)}</span>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="stat-card green">
        <div class="stat-label">Total Tracks</div>
        <div class="stat-value">${d.totalTracks}</div>
        <div class="stat-detail">${d.audioCount} audio · ${d.midiCount} MIDI · ${d.groupCount} group · ${d.returnCount} return</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-label">Plugin Instances</div>
        <div class="stat-value">${d.totalPluginInstances}</div>
        <div class="stat-detail">${d.uniquePlugins} unique plugin${d.uniquePlugins!==1?'s':''}</div>
      </div>
      <div class="stat-card pink">
        <div class="stat-label">Clips</div>
        <div class="stat-value">${d.clipCount}</div>
        <div class="stat-detail">across all tracks</div>
      </div>
      <div class="stat-card gray">
        <div class="stat-label">Frozen Tracks</div>
        <div class="stat-value">${d.frozenTracks.length}</div>
        <div class="stat-detail">${d.emptyChains.length} track${d.emptyChains.length!==1?'s':''} with no devices</div>
      </div>
    </div>

    <div class="section-card">
      <div class="section-header">
        <span class="section-title">Track Type Breakdown</span>
        <span class="section-count">${d.totalTracks} total</span>
      </div>
      <div class="section-body">
        <div class="track-breakdown">
          <div class="track-seg seg-audio"  style="width:${pct(d.audioCount)}%"></div>
          <div class="track-seg seg-midi"   style="width:${pct(d.midiCount)}%"></div>
          <div class="track-seg seg-group"  style="width:${pct(d.groupCount)}%"></div>
          <div class="track-seg seg-return" style="width:${pct(d.returnCount)}%"></div>
        </div>
        <div class="track-legend">
          <div class="legend-item"><div class="legend-dot" style="background:var(--accent)"></div><b>${d.audioCount}</b> <span>Audio</span></div>
          <div class="legend-item"><div class="legend-dot" style="background:var(--accent2)"></div><b>${d.midiCount}</b> <span>MIDI</span></div>
          <div class="legend-item"><div class="legend-dot" style="background:var(--accent3)"></div><b>${d.groupCount}</b> <span>Group</span></div>
          <div class="legend-item"><div class="legend-dot" style="background:#f5a042"></div><b>${d.returnCount}</b> <span>Return</span></div>
        </div>
      </div>
    </div>

    ${sortedPlugins.length ? `
    <div class="section-card">
      <div class="section-header">
        <span class="section-title">Third-Party Plugins</span>
        <span class="section-count">${d.totalPluginInstances} instances · ${d.uniquePlugins} unique</span>
      </div>
      <div class="section-body">
        <table class="plugin-table">
          <thead><tr><th>Plugin</th><th>Instances</th></tr></thead>
          <tbody>${pluginRows}</tbody>
        </table>
      </div>
    </div>` : ''}

    ${sortedNative.length ? `
    <div class="section-card">
      <div class="section-header">
        <span class="section-title">Ableton Native Devices</span>
        <span class="section-count">${Object.values(d.nativeDevices).reduce((a,b)=>a+b,0)} instances</span>
      </div>
      <div class="section-body">
        <table class="plugin-table">
          <thead><tr><th>Device</th><th>Instances</th></tr></thead>
          <tbody>${nativeRows}</tbody>
        </table>
      </div>
    </div>` : ''}

    ${flags.length ? `
    <div class="section-card">
      <div class="section-header"><span class="section-title">Observations</span></div>
      <div class="section-body"><div class="flags">${flags.join('')}</div></div>
    </div>` : ''}

    <div class="section-card">
      <div class="section-header">
        <span class="section-title">All Tracks</span>
        <span class="section-count">${d.trackDetails.length} tracks incl. return &amp; master</span>
      </div>
      <div class="section-body scrollable">${trackRows}</div>
    </div>

    <button id="resetBtn" onclick="resetUI()">← Analyse another file</button>
  `;

  results.classList.add('visible');
  dropzone.style.display = 'none';
}

function resetUI() {
  results.innerHTML = '';
  results.classList.remove('visible');
  dropzone.style.display = '';
  fileInput.value = '';
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
