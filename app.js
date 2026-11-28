(async () => {
// ---------- Configuration de la synchronisation (projet Supabase) ----------
const SB_URL = 'https://hblqrpppbtljrncpjrsy.supabase.co';
// Clé publique « anon » : faite pour être visible ; les règles d'accès (RLS) protègent les données
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhibHFycHBwYnRsanJuY3BqcnN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU4MzA4OTMsImV4cCI6MjExMTQwNjg5M30.tZCrrkVBTFD_PrOkWvqQMxjDh91H7N0mzAHhI6lIiMs';
const $ = s => document.querySelector(s);
const body = $('#body');
const I = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>'
};

function toast(m) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.append(t); setTimeout(() => t.remove(), 3500); }
function ask(msg, ok) {
  const s = document.createElement('div'); s.className = 'sheet';
  s.innerHTML = '<div><p></p><button class="danger">Supprimer</button><button class="cancel">Annuler</button></div>';
  s.querySelector('p').textContent = msg;
  s.onclick = e => { if (e.target.classList.contains('danger')) ok(); if (e.target === s || e.target.tagName === 'BUTTON') s.remove(); };
  document.body.append(s);
}

// ---------- Stockage (IndexedDB : notes + fichiers audio) ----------
let db;
try {
  db = await new Promise((res, rej) => {
    const r = indexedDB.open('notes-app', 2);
    r.onupgradeneeded = () => { const d = r.result; for (const n of ['notes', 'audio', 'songs', 'sets']) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  navigator.storage?.persist?.();
} catch (e) { toast('Stockage indisponible sur ce navigateur'); return; }
const tx = (st, mode, fn) => new Promise((res, rej) => { const t = db.transaction(st, mode), r = fn(t.objectStore(st)); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); });
const allNotes = () => tx('notes', 'readonly', s => s.getAll());
const putNote = n => tx('notes', 'readwrite', s => s.put(n));
const delNote = id => tx('notes', 'readwrite', s => s.delete(id));
const putAudio = a => tx('audio', 'readwrite', s => s.put(a));
const getAudio = id => tx('audio', 'readonly', s => s.get(id));
const delAudio = id => tx('audio', 'readwrite', s => s.delete(id));
const all = st => tx(st, 'readonly', s => s.getAll());
const get = (st, id) => tx(st, 'readonly', s => s.get(id));
const put = (st, o) => tx(st, 'readwrite', s => s.put(o));
const del = (st, id) => tx(st, 'readwrite', s => s.delete(id));

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = s => { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dfmt = t => new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

let nav = [], songs = new Map(), sets = new Map(), editTouched = new Set();
let touched = false, notes = [], cur = null, dirty = false, saveT, range = null, playing = null, rec = null, urls = {}, blobs = {};

// ---------- Liste ----------
const renderList = () => renderTab();
async function renderNotes() {
  notes = (await allNotes()).filter(n => !n.deleted).sort((a, b) => b.updated - a.updated);
  const q = $('#q').value.trim().toLowerCase();
  const list = notes.filter(n => !q || ((n.title || '') + ' ' + (n.text || '')).toLowerCase().includes(q));
  $('#count').textContent = notes.length + (notes.length > 1 ? ' notes' : ' note');
  $('#grid').innerHTML = list.length ? list.map(n => `<button class="card" data-id="${esc(n.id)}"><b>${esc(n.title || 'Sans titre')}</b><span>${esc(n.text || '')}</span><small>${n.recs ? I.mic + esc(n.recs) + ' · ' : ''}${esc(new Date(n.updated).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }))}</small></button>`).join('')
    : `<div class="empty">${q ? 'Aucun résultat' : 'Aucune note.<br>Touchez + pour commencer.'}</div>`;
}
$('#q').addEventListener('input', renderList);
$('#grid').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) openNote(notes.find(n => n.id === c.dataset.id)); });
const newNote = () => openNote({ id: uid(), title: '', html: '', text: '', recs: 0, updated: Date.now() });

// ---------- Éditeur ----------
async function openNote(n) {
  cur = n; dirty = false; touched = false; range = null;
  $('#title').value = n.title || '';
  body.innerHTML = n.html || '';
  $('#date').textContent = dfmt(n.updated);
  showView('editor');
  $('.scroller').scrollTop = 0;
  if (!n.title && !n.html) setTimeout(() => $('#title').focus(), 50);
  for (const old of body.querySelectorAll('.rec')) {
    // Reconstruit le lecteur (met aussi à jour les anciens enregistrements sans titre)
    const c = chip(old.dataset.id, +old.dataset.d || 0, old.dataset.title);
    old.replaceWith(c);
    const a = await getAudio(c.dataset.id);
    if (a) { urls[c.dataset.id] = URL.createObjectURL(a.blob); memBlob(c.dataset.id, a.blob); }
  }
}
function showList() {
  stopPlay();
  Object.values(urls).forEach(u => URL.revokeObjectURL(u)); urls = {}; blobs = {};
  nav = []; render();
}
function sched() { dirty = touched = true; clearTimeout(saveT); saveT = setTimeout(save, 400); }
async function save() {
  clearTimeout(saveT);
  if (!cur || !dirty) return; dirty = false;
  const a = body.cloneNode(true); a.querySelectorAll('.rec').forEach(resetChip);
  const b = body.cloneNode(true); b.querySelectorAll('.rec').forEach(r => r.remove());
  b.querySelectorAll('div,p,li,br').forEach(e => e.before(' '));
  cur.title = $('#title').value.trim();
  cur.html = a.innerHTML;
  cur.text = b.textContent.replace(/\s+/g, ' ').trim();
  cur.recs = body.querySelectorAll('.rec').length;
  cur.updated = Date.now();
  await putNote(cur);
  $('#date').textContent = dfmt(cur.updated);
  syncSoon();
}
$('#title').addEventListener('input', sched);
body.addEventListener('input', e => {
  // Entrée sur une ligne de structure : la nouvelle ligne reste une structure
  if (e.inputType === 'insertParagraph') {
    const s = getSelection(), line = s.rangeCount && lineAt(s.getRangeAt(0));
    const blk = line && line.blk;
    if (blk && !isSt(blk)) {
      let prev = blk.previousSibling; while (isRec(prev)) prev = prev.previousSibling;
      if (isSt(prev)) blk.classList.add('st');
    }
    stState();
  }
  sched();
});
$('#title').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); body.focus(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) { save(); flush(); } });

$('#back').onclick = async () => {
  if (rec) await stopRec();
  await save();
  if (cur && !cur.title && !(cur.text || '').trim() && !cur.recs && !$('#title').value.trim() && !body.textContent.trim() && !body.querySelector('.rec')) await removeNote(cur, []);
  cur = null; showList(); syncSoon(300);
};
$('#del').onclick = () => ask('Supprimer cette note ?', async () => {
  if (rec) await stopRec();
  stopPlay();
  await removeNote(cur, [...body.querySelectorAll('.rec')].map(r => r.dataset.id));
  cur = null; dirty = false; showList(); syncSoon(300);
});

// Sélection / insertion
document.addEventListener('selectionchange', () => { const s = getSelection(); if (s.rangeCount && body.contains(s.anchorNode)) { range = s.getRangeAt(0).cloneRange(); stState(); } });
// Le bouton Structure est allumé quand le curseur est sur une ligne de structure
function stState() {
  const line = range && lineAt(range);
  $('[data-cmd=struct]').classList.toggle('on', !!(line && isSt(line.blk)));
}
function placeRange() {
  body.focus();
  const s = getSelection(); s.removeAllRanges();
  if (range && body.contains(range.startContainer)) s.addRange(range);
  else { const r = document.createRange(); r.selectNodeContents(body); r.collapse(false); s.addRange(r); }
  const r = s.getRangeAt(0);
  const p = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
  const chipEl = p.closest && p.closest('.rec');
  if (chipEl) { r.setStartAfter(chipEl); r.collapse(true); }
  return r;
}
function caretAt(node, offset) { const r = document.createRange(); r.setStart(node, offset); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); range = r.cloneRange(); }
function insertBlock(node) {
  const r = placeRange(); r.deleteContents();
  const after = document.createElement('div'); after.innerHTML = '<br>';
  r.insertNode(after); r.insertNode(node);
  caretAt(after, 0); sched();
}

// Barre d'outils (pointerdown bloqué pour garder le clavier ouvert)
$('.tools').addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); });
$('.tools').addEventListener('click', e => {
  const b = e.target.closest('[data-cmd]'); if (!b) return;
  const c = b.dataset.cmd;
  if (c === 'struct') {
    toggleStructure(placeRange());
  } else if (c === 'check') {
    const r = placeRange(); r.deleteContents();
    const d = document.createElement('div');
    d.innerHTML = '<i class="cb" contenteditable="false"></i> ';
    r.insertNode(d); caretAt(d.lastChild, 1);
  } else {
    placeRange();
    document.execCommand(c === 'list' ? 'insertUnorderedList' : c);
  }
  sched();
});

// Clics dans la note : cases à cocher + lecteurs audio
body.addEventListener('click', e => {
  const cb = e.target.closest('.cb');
  if (cb) { cb.classList.toggle('on'); sched(); }
});
// Lecteurs audio (notes, fiches de chant, chants d'un set)
const recChanged = cont => cont === body ? (sched(), save()) : cont.recChanged();
document.addEventListener('click', e => {
  const c = e.target.closest('.rec'); if (!c) return;
  const cont = c.closest('.recs') || body;
  e.preventDefault();
  if (e.target.closest('.nm')) renameRec(c, cont);
  else if (e.target.closest('.sh')) shareRec(c);
  else if (e.target.closest('.x')) {
    ask('Supprimer cet enregistrement ?', async () => {
      if (playing && playing.chip === c) stopPlay();
      c.remove(); await delAudio(c.dataset.id); cloudRemove([c.dataset.id]); recChanged(cont);
    });
  } else if (e.target.closest('.pl')) togglePlay(c);
});

// ---------- Audio ----------
function chip(id, d, title) {
  const c = document.createElement('div');
  c.className = 'rec'; c.contentEditable = 'false'; c.dataset.id = id; c.dataset.d = d.toFixed(1);
  c.innerHTML = `<button class="pl" type="button" aria-label="Lire">${I.play}</button><span class="mid"><button class="nm" type="button" aria-label="Renommer"></button><span class="row"><span class="tr"><i></i></span><span class="t">${fmt(d)}</span></span></span><button class="sh" type="button" aria-label="Partager">${I.share}</button><button class="x" type="button" aria-label="Supprimer">${I.x}</button>`;
  setTitle(c, title);
  return c;
}
function setTitle(c, t) {
  t = (t || '').replace(/\s+/g, ' ').trim();
  if (t) c.dataset.title = t; else delete c.dataset.title;
  c.querySelector('.nm').textContent = t || 'Sans titre';
}

// ---------- Titres des enregistrements ----------
const isBlock = n => n.nodeType === 1 && /^(DIV|P|LI|UL|OL|BR|H[1-6]|BLOCKQUOTE)$/.test(n.tagName);
const isRec = n => n && n.nodeType === 1 && n.classList.contains('rec');
const clean = s => s.replace(/\s+/g, ' ').trim();
function textOf(n) { const c = n.cloneNode(true); if (c.querySelectorAll) c.querySelectorAll('.rec').forEach(r => r.remove()); return clean(c.textContent); }
// Toutes les lignes écrites dans la note (sans doublons)
function noteLines() {
  const b = body.cloneNode(true); b.querySelectorAll('.rec,.st').forEach(r => r.remove());
  b.querySelectorAll('div,p,li,br').forEach(e => e.before('\n'));
  return [...new Set(b.textContent.split('\n').map(clean).filter(Boolean))];
}
// Ligne où se trouve le curseur : son texte + où placer l'enregistrement
function lineAt(r) {
  if (!r || !body.contains(r.startContainer)) return null;
  let n = r.startContainer;
  if (n === body) { n = body.childNodes[r.startOffset] || body.childNodes[r.startOffset - 1]; if (!n) return null; }
  const el = n.nodeType === 1 ? n : n.parentNode;
  if (el.closest('.rec')) return null;
  const li = el.closest('li');
  if (li && body.contains(li)) return { text: textOf(li), anchor: li, inside: true, blk: li };
  let top = n; while (top.parentNode !== body) top = top.parentNode;
  if (isRec(top) || (top.nodeType === 1 && top.tagName === 'BR')) return null;
  if (isBlock(top)) return { text: textOf(top), anchor: top, blk: top };
  let s = top, e = top, t = '';
  while (s.previousSibling && !isBlock(s.previousSibling)) s = s.previousSibling;
  while (e.nextSibling && !isBlock(e.nextSibling)) e = e.nextSibling;
  for (let x = s; ; x = x.nextSibling) { t += x.textContent; if (x === e) break; }
  const runEnd = e;
  if (e.nextSibling && e.nextSibling.nodeName === 'BR') e = e.nextSibling;
  return { text: clean(t), anchor: e, s, e: runEnd };
}
const isSt = n => n && n.nodeType === 1 && n.classList.contains('st');
// Titre du chant au-dessus d'une ligne de structure
function songAbove(blk) {
  let x = blk.previousSibling;
  while (x) {
    if (isRec(x) || isSt(x) || x.nodeName === 'BR') { x = x.previousSibling; continue; }
    if (isBlock(x)) { const t = textOf(x); if (t) return t; x = x.previousSibling; continue; }
    let t = ''; while (x && !isBlock(x)) { t = x.textContent + t; x = x.previousSibling; }
    if (clean(t)) return clean(t);
  }
  return '';
}
// Titre proposé pour un enregistrement lancé sur cette ligne
function lineTitle(line) {
  if (!line) return '';
  return isSt(line.blk) ? songAbove(line.blk) : line.text;
}
// Marque / démarque la ligne du curseur comme « structure »
function toggleStructure(r) {
  const line = lineAt(r);
  if (!line) { toast('Place le curseur sur une ligne'); return; }
  let blk = line.blk;
  if (!blk) { // ligne de texte « nue » : on l'emballe dans un bloc
    blk = document.createElement('div');
    line.s.before(blk);
    let x = line.s; for (;;) { const nx = x.nextSibling, last = x === line.e; blk.append(x); if (last) break; x = nx; }
    if (blk.nextSibling && blk.nextSibling.nodeName === 'BR') blk.nextSibling.remove();
    const sr = document.createRange(); sr.selectNodeContents(blk); sr.collapse(false);
    getSelection().removeAllRanges(); getSelection().addRange(sr); range = sr.cloneRange();
  }
  blk.classList.toggle('st');
  if (!blk.classList.length) blk.removeAttribute('class');
  toast(isSt(blk) ? 'Structure activée' : 'Structure désactivée');
  stState(); sched();
}
// Place l'enregistrement juste sous sa ligne (après les autres enregistrements de cette ligne)
function insertRec(c, line) {
  if (!line || !line.anchor.isConnected) return insertBlock(c);
  if (line.inside) line.anchor.append(c);
  else { let a = line.anchor; while (isRec(a.nextSibling)) a = a.nextSibling; a.after(c); }
  if (c.parentNode === body && !c.nextSibling) { const d = document.createElement('div'); d.innerHTML = '<br>'; c.after(d); }
  body.focus();
  caretAt(c.parentNode, [...c.parentNode.childNodes].indexOf(c) + 1);
  sched();
}
function renameRec(c, cont = body) {
  const s = document.createElement('div'); s.className = 'sheet';
  s.innerHTML = '<div><p>Titre de l\'enregistrement</p><input class="ti" placeholder="Titre" enterkeyhint="done"><small></small><div class="lines"></div><button class="ok">Enregistrer</button><button class="cancel">Annuler</button></div>';
  const inp = s.querySelector('.ti'); inp.value = c.dataset.title || '';
  const lines = cont === body ? noteLines() : [...new Set((cont.recSuggest ? cont.recSuggest() : []).map(clean).filter(Boolean))];
  s.querySelector('small').textContent = lines.length ? (cont === body ? 'Ou choisir une ligne de la note :' : 'Suggestions :') : '';
  const box = s.querySelector('.lines');
  for (const l of lines) { const b = document.createElement('button'); b.className = 'line'; b.textContent = l; box.append(b); }
  const done = t => { setTitle(c, t); recChanged(cont); s.remove(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(inp.value); } });
  s.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (e.target === s || (b && b.classList.contains('cancel'))) s.remove();
    else if (b && b.classList.contains('line')) done(b.textContent);
    else if (b && b.classList.contains('ok')) done(inp.value);
  });
  document.body.append(s);
}
// ---------- Partage (le fichier porte le titre de l'enregistrement) ----------
// Copie en mémoire de l'audio : Safari refuse parfois de partager un fichier lu depuis IndexedDB
const baseType = t => (t || 'audio/mp4').split(';')[0].trim();
async function memBlob(id, blob) {
  blobs[id] = blob;
  try { const buf = await blob.arrayBuffer(); if (blobs[id] === blob) blobs[id] = new Blob([buf], { type: baseType(blob.type) }); } catch (e) {}
}
// Fichiers candidats : chaque plateforme n'accepte que certains couples type/extension
// (Chrome Android refuse « audio/mp4 » mais accepte « audio/x-m4a » ; Safari accepte « audio/mp4 »)
function recFiles(c) {
  const blob = blobs[c.dataset.id]; if (!blob) return [];
  const type = baseType(blob.type);
  const base = ((c.dataset.title || 'Enregistrement').replace(/[\/\\:*?"<>|]+/g, '-').trim().slice(0, 80) || 'Enregistrement');
  const opts = /webm/.test(type) ? [['audio/webm', 'webm'], ['audio/webm', 'weba'], ['video/webm', 'webm']]
    : /ogg/.test(type) ? [['audio/ogg', 'ogg']]
    : [['audio/mp4', 'm4a'], ['audio/x-m4a', 'm4a'], ['video/mp4', 'mp4']];
  return opts.map(([t, ext]) => new File([blob], base + '.' + ext, { type: t }));
}
function recFile(c) {
  const fs = recFiles(c); if (!fs.length) return null;
  return (navigator.canShare && fs.find(f => navigator.canShare({ files: [f] }))) || fs[0];
}
function download(f) {
  const a = document.createElement('a'), u = URL.createObjectURL(f);
  a.href = u; a.download = f.name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
function shareRec(c) {
  const f = recFile(c);
  if (!f) { toast('Audio introuvable'); return; }
  if (!f.size) { toast('Cet enregistrement est vide'); return; }
  if (!(navigator.share && navigator.canShare && navigator.canShare({ files: [f] }))) {
    shareFallback(c, { name: 'Partage de fichiers non disponible sur ce navigateur' }); return;
  }
  // Uniquement le fichier (pas de titre/texte) : c'est ce que Safari accepte le mieux
  navigator.share({ files: [f] }).catch(e => { if (e.name !== 'AbortError') shareFallback(c, e); });
}
// Si le partage échoue : nouvelle tentative (nouveau toucher) ou téléchargement
function shareFallback(c, err) {
  const s = document.createElement('div'); s.className = 'sheet';
  s.innerHTML = '<div><p>Le partage n\'a pas marché</p><small></small><button class="ok">Réessayer le partage</button><button class="dl">Enregistrer le fichier</button><button class="cancel">Annuler</button></div>';
  s.querySelector('small').textContent = 'Erreur : ' + (err && (err.name + (err.message ? ' – ' + err.message : '')) || 'inconnue');
  s.querySelector('.dl').style.background = 'var(--bg)';
  s.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (e.target === s || (b && b.classList.contains('cancel'))) { s.remove(); return; }
    if (!b) return;
    s.remove();
    const f = recFile(c); if (!f) return;
    if (b.classList.contains('dl')) download(f);
    else navigator.share({ files: [f] }).catch(e2 => { if (e2.name !== 'AbortError') toast('Partage impossible : ' + e2.name + '. Utilise « Enregistrer le fichier ».'); });
  });
  document.body.append(s);
}
function resetChip(c) {
  c.querySelector('.pl').innerHTML = I.play;
  c.querySelector('.tr i').style.width = '0';
  c.querySelector('.t').textContent = fmt(+c.dataset.d);
}
function stopPlay() { if (!playing) return; playing.a.pause(); if (playing.chip.isConnected) resetChip(playing.chip); playing = null; }
function togglePlay(c) {
  if (playing && playing.chip === c) { playing.a.paused ? playing.a.play() : playing.a.pause(); return; }
  stopPlay();
  const url = urls[c.dataset.id];
  if (!url) { toast('Audio introuvable'); return; }
  const a = new Audio(url), d = +c.dataset.d || 1;
  playing = { a, chip: c };
  a.onplay = () => c.querySelector('.pl').innerHTML = I.pause;
  a.onpause = () => c.querySelector('.pl').innerHTML = I.play;
  a.ontimeupdate = () => { c.querySelector('.tr i').style.width = Math.min(100, a.currentTime / d * 100) + '%'; c.querySelector('.t').textContent = fmt(a.currentTime) + ' / ' + fmt(d); };
  a.onended = stopPlay;
  a.play().catch(() => { toast('Lecture impossible'); stopPlay(); });
}

const elapsed = () => rec.acc + (rec.mr.state === 'recording' ? Date.now() - rec.start : 0);
const tick = () => { if (rec) $('#tm').textContent = fmt(elapsed() / 1000) + (rec.title ? ' · ' + rec.title : ''); };
$('#mic').addEventListener('click', () => {
  if (rec) return stopRec();
  // Le titre est la ligne où se trouve le curseur au moment de lancer l'enregistrement
  // (sur une ligne de structure : titre du chant au-dessus)
  const line = lineAt(range);
  const title = lineTitle(line) || 'Enregistrement ' + (body.querySelectorAll('.rec').length + 1);
  startRec({ title, onDone: async (id, dur, t) => { insertRec(chip(id, dur, t), line && line.text ? line : null); await save(); } });
});
// Bouton « Enregistrer » d'une fiche : démarre, ou arrête si un enregistrement est en cours
const recToggle = (title, onDone) => rec ? stopRec() : startRec({ title, onDone });
async function startRec(opts) {
  if (rec) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast("Enregistrement non disponible ici. Ouvre l'app dans Safari, via une adresse https."); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { toast('Accès au micro refusé (Réglages › Safari › Micro)'); return; }
  stopPlay();
  const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec = { mr, stream, chunks, start: Date.now(), acc: 0, iv: setInterval(tick, 250), title: opts.title, onDone: opts.onDone };
  mr.start(1000);
  $('#pause').textContent = 'Pause';
  $('#recbar').classList.remove('hidden'); tick();
}
$('#pause').onclick = () => {
  if (!rec) return;
  if (rec.mr.state === 'recording') { rec.acc += Date.now() - rec.start; rec.mr.pause(); $('#pause').textContent = 'Reprendre'; }
  else { rec.start = Date.now(); rec.mr.resume(); $('#pause').textContent = 'Pause'; }
};
$('#stop').onclick = () => stopRec();
function stopRec() {
  return new Promise(res => {
    const r = rec; if (!r) return res();
    const dur = elapsed() / 1000;
    rec = null; clearInterval(r.iv);
    $('#recbar').classList.add('hidden');
    r.mr.onstop = async () => {
      r.stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(r.chunks, { type: r.mr.mimeType || 'audio/mp4' });
      const id = uid();
      await putAudio({ id, blob, d: dur });
      urls[id] = URL.createObjectURL(blob); memBlob(id, blob);
      await r.onDone(id, dur, r.title); res();
    };
    r.mr.stop();
  });
}

// ---------- Synchronisation entre appareils (Supabase) ----------
// Notes : table « notes » (dernière modification gagne). Audio : bucket « audio », dossier = utilisateur.
// Une note supprimée devient une « pierre tombale » (deleted) pour que la suppression se propage.
const sb = SB_URL && SB_KEY && window.supabase ? window.supabase.createClient(SB_URL, SB_KEY) : null;
let user = null, syncing = null, syncT, lastSync = 0, syncErr = '', syncStage = '', audioErr = '';
async function removeNote(n, recIds) {
  for (const id of recIds) await delAudio(id);
  cloudRemove(recIds);
  if (n.synced) await putNote({ id: n.id, deleted: true, updated: Date.now() });
  else await delNote(n.id);
}
// Identifiants audio utilisés par un document (note, chant ou set)
const audioIdsOf = (st, o) => st === 'notes' ? recIdsOf(o.html) : st === 'songs' ? (o.recs || []).map(r => r.id) : (o.items || []).flatMap(it => (it.recs || []).map(r => r.id));
function cloudRemove(ids) {
  if (sb && user && ids.length) sb.storage.from('audio').remove(ids.map(id => user.id + '/' + id)).catch(() => {});
}
const recIdsOf = html => { const t = document.createElement('template'); t.innerHTML = html || ''; return [...t.content.querySelectorAll('.rec')].map(r => r.dataset.id); };
function syncUI() {
  const c = $('#cloud');
  c.classList.toggle('on', !!user); c.classList.toggle('busy', !!syncing); c.classList.toggle('err', !!(user && syncErr));
  $('#sync').textContent = !user ? '' : syncErr ? '· erreur de synchro' : !navigator.onLine ? '· hors ligne' : lastSync ? '· synchronisé ' + new Date(lastSync).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
}
function syncSoon(ms = 2000) { if (!sb || !user) return; clearTimeout(syncT); syncT = setTimeout(sync, ms); }
function sync() {
  if (!sb || !user || !navigator.onLine) { syncUI(); return Promise.resolve(); }
  if (syncing) return syncing.then(() => sync());
  syncStage = 'lecture';
  syncing = doSync().then(() => { syncErr = ''; lastSync = Date.now(); }, e => { syncErr = '[' + syncStage + '] ' + ((e && (e.name && e.name !== 'Error' ? e.name + ' : ' : '') + (e.message || '')) || String(e)); console.warn('sync', e); })
    .finally(() => { syncing = null; syncUI(); });
  syncUI();
  return syncing;
}
const KINDS = { note: 'notes', song: 'songs', set: 'sets' };
const strip = o => { const { id, updated, synced, deleted, ...d } = o; return d; };
async function doSync() {
  const { data: remote, error } = await sb.from('docs').select('id,kind,data,updated,deleted');
  if (error) throw error;
  let changed = false; audioErr = '';
  for (const [kind, st] of Object.entries(KINDS)) {
    const local = new Map((await all(st)).map(n => [n.id, n]));
    const rows = remote.filter(r => r.kind === kind), rmap = new Map(rows.map(r => [r.id, r]));
    // 1. Réception : documents plus récents sur le serveur
    for (const r of rows) {
      const l = local.get(r.id);
      if (l && l.updated >= r.updated) continue;
      if ((cur && cur.id === r.id && touched) || editTouched.has(r.id)) continue; // en cours d'édition ici
      if (r.deleted) {
        if (l) { for (const id of audioIdsOf(st, l)) await delAudio(id); await put(st, { id: r.id, deleted: true, updated: r.updated, synced: r.updated }); changed = true; }
        continue;
      }
      syncStage = 'réception ' + kind;
      const n = { ...r.data, id: r.id, updated: r.updated, synced: r.updated };
      await put(st, n); changed = true;
      if (kind === 'note' && cur && cur.id === n.id && !touched) { const sc = $('.scroller').scrollTop; await openNote(n); $('.scroller').scrollTop = sc; }
    }
    // 2. Envoi : documents modifiés ici depuis la dernière synchro
    for (const l of local.values()) {
      const r = rmap.get(l.id);
      if (l.synced === l.updated && r) continue;
      if (r && r.updated >= l.updated) continue;
      if (l.deleted && !r) { await del(st, l.id); continue; }
      syncStage = 'envoi ' + kind;
      if (!l.deleted) for (const id of audioIdsOf(st, l)) {
        try {
          const a = await getAudio(id);
          if (!a || a.up) continue;
          syncStage = 'envoi audio';
          const { error: e } = await sb.storage.from('audio').upload(user.id + '/' + id, a.blob, { upsert: true, contentType: baseType(a.blob.type) });
          if (e) throw e;
          await putAudio({ ...a, up: true });
        } catch (e) { audioErr = (e && (e.name ? e.name + ' : ' : '') + (e.message || '')) || String(e); console.warn('audio', id, e); }
        syncStage = 'envoi ' + kind;
      }
      const row = { id: l.id, user_id: user.id, kind, data: l.deleted ? {} : strip(l), updated: l.updated, deleted: !!l.deleted };
      const { error: e } = await sb.from('docs').upsert(row);
      if (e) throw e;
      const fresh = await get(st, l.id);
      if (fresh && fresh.updated === l.updated) await put(st, { ...fresh, synced: l.updated });
      const mem = st === 'songs' ? songs.get(l.id) : st === 'sets' ? sets.get(l.id) : st === 'notes' && cur && cur.id === l.id ? cur : null;
      if (mem && mem.updated === l.updated) mem.synced = l.updated;
    }
  }
  // 3. Audios manquants sur cet appareil : téléchargés à part, un échec ne bloque pas la synchro
  //    (ils seront retentés à la prochaine synchro)
  syncStage = 'téléchargement audio';
  let gotAudio = false;
  for (const st of Object.values(KINDS)) for (const o of await all(st)) {
    if (o.deleted) continue;
    for (const id of audioIdsOf(st, o)) {
      try {
        if (await getAudio(id)) continue;
        const { data, error: e } = await sb.storage.from('audio').download(user.id + '/' + id);
        if (e) throw e;
        if (data) { await putAudio({ id, blob: new Blob([await data.arrayBuffer()], { type: baseType(data.type) }), d: 0, up: true }); gotAudio = true; }
      } catch (e) { audioErr = (e && (e.name ? e.name + ' : ' : '') + (e.message || '')) || String(e); console.warn('audio', id, e); }
    }
  }
  if (gotAudio && cur && !touched && !$('#editor').classList.contains('hidden')) { const sc = $('.scroller').scrollTop; await openNote(cur); $('.scroller').scrollTop = sc; }
  if (changed || gotAudio) { await loadDocs(); refreshAfterSync(); }
}
// Fenêtre « Synchronisation » : connexion / déconnexion
function cloudSheet() {
  const s = document.createElement('div'); s.className = 'sheet';
  if (!sb) {
    s.innerHTML = '<div><p>Synchronisation</p><small>' + (SB_URL ? 'Service de synchronisation injoignable. Vérifie ta connexion Internet.' : 'La synchronisation n\'est pas encore configurée.') + '</small><button class="cancel">Fermer</button></div>';
  } else if (user) {
    s.innerHTML = '<div><p>Synchronisation</p><small class="who"></small><small class="st"></small><button class="ok now">Synchroniser maintenant</button><button class="alt out">Se déconnecter</button><button class="cancel">Fermer</button></div>';
    s.querySelector('.who').textContent = 'Connecté : ' + user.email;
    s.querySelector('.st').textContent = (syncErr ? 'Erreur : ' + syncErr : lastSync ? 'Dernière synchro : ' + new Date(lastSync).toLocaleString('fr-FR') : '') + (audioErr ? ' — Audio non transféré (réessai automatique) : ' + audioErr : '');
  } else {
    s.innerHTML = '<div><p>Synchroniser mes notes</p><small>Connecte-toi avec le même compte sur chaque appareil (téléphone, tablette…).</small><input class="em" type="email" placeholder="E-mail" autocomplete="email"><input class="pw" type="password" placeholder="Mot de passe (6 caractères min.)" autocomplete="current-password"><button class="ok in">Se connecter</button><button class="alt up">Créer un compte</button><button class="cancel">Annuler</button></div>';
  }
  s.firstChild.insertAdjacentHTML('afterbegin', '<p>Réglages</p><small>Notation des tonalités</small><div class="seg"><button data-n="fr">Do Ré Mi</button><button data-n="en">C D E</button></div>');
  const markN = () => s.querySelectorAll('[data-n]').forEach(x => x.classList.toggle('on', x.dataset.n === notation));
  markN();
  s.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (e.target === s || (b && b.classList.contains('cancel'))) { s.remove(); return; }
    if (!b) return;
    if (b.dataset.n) { notation = b.dataset.n; setPref('notation', notation); markN(); render(); return; }
    if (b.classList.contains('now')) { s.remove(); await sync(); toast(syncErr ? 'Erreur de synchro : ' + syncErr : 'Notes synchronisées'); return; }
    if (b.classList.contains('out')) { await sb.auth.signOut(); s.remove(); toast('Déconnecté. Les notes restent sur cet appareil.'); return; }
    const email = s.querySelector('.em').value.trim(), password = s.querySelector('.pw').value;
    if (!email || password.length < 6) { toast('E-mail et mot de passe (6 caractères min.) requis'); return; }
    b.disabled = true;
    const { data, error } = b.classList.contains('up') ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }) : await sb.auth.signInWithPassword({ email, password });
    b.disabled = false;
    if (error) {
      const m = error.message || '';
      toast(/not confirmed/i.test(m) ? 'Adresse e-mail pas encore confirmée : ouvre le lien reçu par e-mail, puis touche « Se connecter ».'
        : /rate limit|security purposes|after \d+ seconds/i.test(m) ? 'Trop de tentatives : attends une minute avant de réessayer.'
        : /Invalid login/i.test(m) ? 'E-mail ou mot de passe incorrect'
        : /registered/i.test(m) ? 'Ce compte existe déjà : touche « Se connecter »'
        : 'Erreur : ' + m);
      return;
    }
    if (!data.session) { toast('Compte créé. Ouvre le lien de confirmation reçu par e-mail, puis touche « Se connecter ».'); return; }
    s.remove(); toast('Connecté, synchronisation…');
  });
  document.body.append(s);
}
$('#cloud').onclick = cloudSheet;
if (sb) {
  sb.auth.onAuthStateChange((ev, session) => {
    const was = user && user.id; user = session ? session.user : null;
    if (user && user.id !== was) sync(); else syncUI();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncSoon(100); });
  addEventListener('online', () => syncSoon(100)); addEventListener('offline', syncUI);
  setInterval(() => { if (!document.hidden) sync(); }, 30000);
}
syncUI();
// =====================================================================
// ===============  Bibliothèque de chants & sets  =====================
// =====================================================================
// Chant : { id, title, artist, key, bpm, sig, dur (s), style, struct[], links, notes, recs[], updated }
// Set   : { id, name, date (AAAA-MM-JJ), items[], notes, updated }
// Élément de set : { id, songId, title (copie), key|null, struct|null, lead, note, recs[] }
//   key / struct à null = on reprend ceux de la fiche du chant.
// Section de structure : { t: 'C', n: 1, x: 2, i: 'doux' }  →  « C1 ×2 doux »

// ---------- Préférences ----------
function pref(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
function setPref(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
var notation = pref('notation', 'fr');
let tab = pref('tab', 'sets');
if (!['sets', 'songs', 'notes'].includes(tab)) tab = 'sets';

// ---------- Données en mémoire ----------
async function loadDocs() {
  songs = new Map((await all('songs')).filter(o => !o.deleted).map(o => [o.id, o]));
  sets = new Map((await all('sets')).filter(o => !o.deleted).map(o => [o.id, o]));
  refreshStyles();
}
// Enregistrement différé (400 ms) des chants / sets modifiés
const pend = new Map(); let pendT;
function touch(st, o) {
  o.updated = Date.now(); editTouched.add(o.id);
  pend.set(st + ':' + o.id, [st, o]);
  clearTimeout(pendT); pendT = setTimeout(flush, 400);
}
async function flush() {
  clearTimeout(pendT);
  const ps = [...pend.values()]; pend.clear();
  for (const [st, o] of ps) await put(st, o);
  if (ps.length) syncSoon();
}
async function removeDoc(st, o) {
  const ids = audioIdsOf(st, o);
  for (const id of ids) await delAudio(id);
  cloudRemove(ids);
  (st === 'songs' ? songs : sets).delete(o.id); pend.delete(st + ':' + o.id);
  if (o.synced) await put(st, { id: o.id, deleted: true, updated: Date.now() }); else await del(st, o.id);
  syncSoon(300);
}
const newSong = title => {
  const s = { id: uid(), title, artist: '', key: '', bpm: '', sig: '', dur: 0, style: '', struct: [], links: '', notes: '', recs: [], updated: Date.now() };
  songs.set(s.id, s); return s;
};

// ---------- Tonalités ----------
const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const FRN = { C: 'Do', Db: 'Ré♭', D: 'Ré', Eb: 'Mi♭', E: 'Mi', F: 'Fa', 'F#': 'Fa♯', G: 'Sol', Ab: 'La♭', A: 'La', Bb: 'Si♭', B: 'Si' };
function keyLabel(k) {
  if (!k) return '';
  const m = /m$/.test(k), r = m ? k.slice(0, -1) : k;
  return (notation === 'fr' ? (FRN[r] || r) : r.replace('b', '♭').replace('#', '♯')) + (m ? 'm' : '');
}
// Choix d'une tonalité. inherit : libellé du bouton « comme le chant » (renvoie null)
function keySheet(k, onPick, inherit) {
  let minor = /m$/.test(k || '');
  const sh = sheet('<p>Tonalité</p><div class="seg"><button class="maj">Majeur</button><button class="min">Mineur</button></div><div class="grid12"></div><button class="alt none"></button><button class="cancel">Annuler</button>');
  sh.querySelector('.none').textContent = inherit || 'Aucune';
  const draw = () => {
    sh.querySelector('.maj').classList.toggle('on', !minor); sh.querySelector('.min').classList.toggle('on', minor);
    sh.querySelector('.grid12').innerHTML = ROOTS.map(r => { const v = r + (minor ? 'm' : ''); return `<button data-k="${v}" class="${v === k ? 'on' : ''}">${esc(keyLabel(v))}</button>`; }).join('');
  };
  draw();
  sh.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('maj')) { minor = false; draw(); }
    else if (b.classList.contains('min')) { minor = true; draw(); }
    else if (b.dataset.k) { sh.remove(); onPick(b.dataset.k); }
    else if (b.classList.contains('none')) { sh.remove(); onPick(null); }
  });
}

// ---------- Structures ----------
const SEC = {
  I: ['Intro', '#6e6e78'], C: ['Couplet', '#2f6fe0'], PR: ['Pré-refrain', '#0b8a8a'], R: ['Refrain', '#dd5f12'],
  P: ['Pont', '#7c4ddb'], Inst: ['Instrumental', '#15803d'], Int: ['Interlude', '#5b8a12'], Tag: ['Tag', '#c42a71'],
  Vamp: ['Vamp', '#a36f05'], Fin: ['Fin', '#3f4b5c']
};
const ALIAS = { intro: 'I', i: 'I', couplet: 'C', c: 'C', v: 'C', pr: 'PR', prerefrain: 'PR', refrain: 'R', r: 'R', ch: 'R', pont: 'P', p: 'P', b: 'P', bridge: 'P',
  inst: 'Inst', instrumental: 'Inst', solo: 'Inst', int: 'Int', interlude: 'Int', tag: 'Tag', vamp: 'Vamp', fin: 'Fin', f: 'Fin', outro: 'Fin', o: 'Fin', end: 'Fin' };
const secLabel = s => s.t + (s.n || '');
const secColor = t => (SEC[t] || ['', '#888'])[1];
function pillsHTML(st, sm) {
  if (!st || !st.length) return '';
  return `<span class="pills${sm ? ' sm' : ''}">` + st.map((s, i) => `<span class="pill" data-i="${i}" style="--c:${secColor(s.t)}">${esc(secLabel(s))}${s.x > 1 ? '<b>×' + s.x + '</b>' : ''}${s.i ? '<em>' + esc(s.i) + '</em>' : ''}</span>`).join('') + '</span>';
}
const stText = st => (st || []).map(s => secLabel(s) + (s.x > 1 ? 'x' + s.x : '') + (s.i ? '(' + s.i + ')' : '')).join(' ');
// Saisie rapide : « I C1 R C2 R P Rx2 C3(doux) Fin »
function parseSt(txt) {
  const enc = String(txt || '').replace(/\(([^)]*)\)/g, (m, a) => '(' + [...a].map(c => c.codePointAt(0)).join('.') + ')');
  const out = [];
  for (const tok of enc.split(/[\s,;·→>|\/-]+/).filter(Boolean)) {
    const dec = a => a ? clean(a.split('.').filter(Boolean).map(n => String.fromCodePoint(+n)).join('')) : '';
    let m = tok.match(/^[x×*](\d+)$/i);
    if (m && out.length) { out[out.length - 1].x = Math.min(9, +m[1] || 1); continue; }
    m = tok.match(/^\(([\d.]*)\)$/);
    if (m && out.length) { out[out.length - 1].i = dec(m[1]); continue; }
    m = tok.match(/^([a-zé]+?)(\d*)(?:[x×*](\d+))?(?:\(([\d.]*)\))?$/i);
    if (!m) continue;
    const t = ALIAS[m[1].toLowerCase().replace('é', 'e')]; if (!t) continue;
    out.push({ t, n: Math.min(99, +m[2] || 0), x: Math.min(9, +m[3] || 1), i: dec(m[4]) });
  }
  return out;
}
// Éditeur de structure : pastilles + palette + saisie rapide
function structEditor(host, getSt, setSt) {
  host.innerHTML = '<div class="pw"></div><div class="palette"></div><input class="fld quick" placeholder="Saisie rapide : I C1 R C2 R P Rx2 Fin" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done">';
  const wrap = host.querySelector('.pw'), pal = host.querySelector('.palette'), quick = host.querySelector('.quick');
  pal.innerHTML = Object.keys(SEC).map(t => `<button type="button" data-t="${t}" style="--c:${secColor(t)}" aria-label="${SEC[t][0]}">${t}</button>`).join('');
  const draw = () => {
    const st = getSt();
    wrap.innerHTML = st.length ? pillsHTML(st) : '<span class="empty-st">Touchez les sections ci-dessous dans l\'ordre, ou utilisez la saisie rapide.</span>';
    if (document.activeElement !== quick) quick.value = stText(st);
  };
  pal.addEventListener('click', e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    const st = getSt().map(x => ({ ...x })), t = b.dataset.t;
    st.push({ t, n: t === 'C' ? 1 + Math.max(0, ...st.filter(x => x.t === 'C').map(x => x.n || 0)) : 0, x: 1, i: '' });
    setSt(st); draw();
  });
  wrap.addEventListener('click', e => { const p = e.target.closest('.pill'); if (p) pillSheet(+p.dataset.i); });
  quick.addEventListener('change', () => { setSt(parseSt(quick.value)); draw(); });
  quick.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); quick.blur(); } });
  function pillSheet(i) {
    const st = getSt().map(x => ({ ...x })), s0 = { ...st[i] };
    const sh = sheet('<p></p><small>Répétitions</small><div class="stepper"><button class="xm">−</button><span class="xv"></span><button class="xp">+</button></div>'
      + '<small>Numéro</small><div class="stepper"><button class="nm2">−</button><span class="nv"></span><button class="np">+</button></div>'
      + '<small>Indication</small><input class="ind fld" placeholder="Ex. doux, batterie seule…" autocomplete="off"><div class="chips">'
      + ['doux', 'fort', 'batterie seule', 'piano seul', 'a cappella', '+1 (modulation)', 'crescendo', 'break'].map(c => `<button class="chip">${c}</button>`).join('')
      + '</div><div class="row2"><button class="alt left">← Avant</button><button class="alt right">Après →</button></div><button class="ok okb">OK</button><button class="danger rm">Supprimer la section</button><button class="cancel">Annuler</button>');
    const ind = sh.querySelector('.ind'); ind.value = s0.i || '';
    const upd = () => {
      sh.querySelector('p').textContent = secLabel(s0) + ' – ' + SEC[s0.t][0];
      sh.querySelector('.xv').textContent = '×' + (s0.x || 1);
      sh.querySelector('.nv').textContent = s0.n || '–';
      sh.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.textContent === s0.i));
    };
    ind.addEventListener('input', () => { s0.i = clean(ind.value); upd(); });
    upd();
    const commit = arr => { setSt(arr); draw(); sh.remove(); };
    sh.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const c = b.classList;
      if (c.contains('xm')) s0.x = Math.max(1, (s0.x || 1) - 1);
      else if (c.contains('xp')) s0.x = Math.min(9, (s0.x || 1) + 1);
      else if (c.contains('nm2')) s0.n = Math.max(0, (s0.n || 0) - 1);
      else if (c.contains('np')) s0.n = Math.min(99, (s0.n || 0) + 1);
      else if (c.contains('chip')) { s0.i = s0.i === b.textContent ? '' : b.textContent; ind.value = s0.i; }
      else if (c.contains('left') || c.contains('right')) {
        const j = i + (c.contains('left') ? -1 : 1); if (j < 0 || j >= st.length) return;
        st[i] = s0; [st[i], st[j]] = [st[j], st[i]]; commit(st); return;
      }
      else if (c.contains('okb')) { st[i] = s0; commit(st); return; }
      else if (c.contains('rm')) { st.splice(i, 1); commit(st); return; }
      else return;
      upd();
    });
  }
  draw();
  return { draw };
}

// ---------- Petits utilitaires ----------
function sheet(html) {
  const s = document.createElement('div'); s.className = 'sheet';
  s.innerHTML = '<div>' + html + '</div>';
  s.addEventListener('click', e => { if (e.target === s || e.target.closest('.cancel')) s.remove(); });
  document.body.append(s); return s;
}
const parseDur = v => { const m = String(v || '').trim().match(/^(\d{1,3})(?:\s*[:h'.,]\s*(\d{1,2}))?$/); return m ? (+m[1]) * 60 + (+(m[2] || 0)) : 0; };
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const dParse = iso => /^\d{4}-\d\d-\d\d$/.test(iso || '') ? new Date(iso + 'T12:00:00') : null;
const dShort = iso => { const d = dParse(iso); return d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : ''; };
const itemTitle = it => clean((songs.get(it.songId) || {}).title || it.title || '') || 'Chant supprimé';
const itemKey = it => it.key || (songs.get(it.songId) || {}).key || '';
const itemSt = it => it.struct || (songs.get(it.songId) || {}).struct || [];
function setSummary(set) {
  const n = set.items.length; let tot = 0, miss = 0;
  for (const it of set.items) { const d = (songs.get(it.songId) || {}).dur || 0; if (d) tot += d; else miss++; }
  return n + (n > 1 ? ' chants' : ' chant') + (tot ? ' · ~' + Math.max(1, Math.round(tot / 60)) + ' min' + (miss ? ' (+' + miss + ' sans durée)' : '') : '');
}
const STYLES = ['Louange', 'Adoration', 'Gospel', 'Pop', 'Rock', 'Ballade', 'Shuffle', 'Reggae', 'Afro', 'Zouk', 'Kompa', 'Latino', 'Hymne', 'Acoustique', 'Soul', 'Funk', 'Rapide', 'Lent'];
function refreshStyles() {
  const all = new Set([...STYLES, ...[...songs.values()].map(s => clean(s.style || '')).filter(Boolean)]);
  $('#styles').innerHTML = [...all].map(v => `<option value="${esc(v)}">`).join('');
}
// Liste d'enregistrements d'une fiche (chant ou chant d'un set)
function renderRecs(host, arr, onChange, suggest) {
  host.innerHTML = '';
  host.recChanged = () => onChange([...host.querySelectorAll('.rec')].map(c => ({ id: c.dataset.id, d: +c.dataset.d || 0, title: c.dataset.title || '' })));
  host.recSuggest = suggest;
  for (const r of arr || []) { host.append(chip(r.id, r.d || 0, r.title)); loadAudio(r.id); }
}
async function loadAudio(id) {
  if (urls[id]) return;
  const a = await getAudio(id);
  if (a) { urls[id] = URL.createObjectURL(a.blob); memBlob(id, a.blob); }
}

// ---------- Navigation entre écrans ----------
const VIEWS = ['list', 'editor', 'song', 'set', 'item'];
function showView(v) { VIEWS.forEach(x => $('#' + x).classList.toggle('hidden', x !== v)); }
const topNav = () => nav[nav.length - 1];
async function go(v, params) {
  await flush();
  const t = topNav(); if (t) t.scroll = $('#' + t.v + ' .scroller').scrollTop;
  nav.push({ v, ...params }); render(true);
}
async function goBack() {
  if (rec) await stopRec();
  await flush();
  const t = nav.pop();
  if (t && t.v === 'song') { const s = songs.get(t.id); if (s && !clean(s.title || '') && !s.artist && !s.key && !(s.struct || []).length && !(s.recs || []).length && !s.notes && !s.links && ![...sets.values()].some(x => x.items.some(i => i.songId === s.id))) await removeDoc('songs', s); }
  if (t && t.v === 'set') { const s = sets.get(t.id); if (s && !clean(s.name || '') && !s.items.length && !s.notes) await removeDoc('sets', s); }
  render();
}
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', goBack));
function render(fresh) {
  const t = topNav();
  if (!t) { showView('list'); editTouched.clear(); renderTab(); return; }
  showView(t.v);
  const prev = nav[nav.length - 2];
  $('#' + t.v + ' [data-back] span').textContent = !prev ? { sets: 'Sets', songs: 'Chants', notes: 'Notes' }[tab] : { set: 'Set', song: 'Chant', item: 'Retour' }[prev.v];
  ({ song: renderSong, set: renderSet, item: renderItem })[t.v](t);
  if (fresh || t.scroll != null) $('#' + t.v + ' .scroller').scrollTop = fresh ? 0 : t.scroll;
}
// Après une synchro : on rafraîchit l'écran affiché (sauf s'il est en cours d'édition)
function refreshAfterSync() {
  const t = topNav();
  if (!t) { if (!$('#list').classList.contains('hidden')) renderTab(); return; }
  if (editTouched.has(t.id)) return;
  if (!(t.v === 'song' ? songs : sets).has(t.id)) { nav.pop(); render(); return; }
  t.scroll = $('#' + t.v + ' .scroller').scrollTop; render();
}

// ---------- Accueil : onglets ----------
function renderTab() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#h1').textContent = { sets: 'Sets', songs: 'Chants', notes: 'Notes' }[tab];
  $('#q').placeholder = { sets: 'Rechercher un set ou un chant', songs: 'Rechercher un chant, un auteur, un style', notes: 'Rechercher' }[tab];
  $('#new').setAttribute('aria-label', { sets: 'Nouveau set', songs: 'Nouveau chant', notes: 'Nouvelle note' }[tab]);
  $('#grid').classList.toggle('rows', tab !== 'notes');
  return tab === 'notes' ? renderNotes() : tab === 'songs' ? renderSongs() : renderSets();
}
$('.tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  tab = b.dataset.tab; setPref('tab', tab); $('#q').value = ''; renderTab(); $('#grid').scrollTop = 0;
});
$('#new').onclick = async () => {
  if (tab === 'notes') return newNote();
  if (tab === 'songs') { const s = newSong(''); await put('songs', s); return go('song', { id: s.id, focus: true }); }
  const s = { id: uid(), name: '', date: todayISO(), items: [], notes: '', updated: Date.now() };
  sets.set(s.id, s); await put('sets', s); go('set', { id: s.id, focus: true });
};
$('#grid').addEventListener('click', e => {
  const so = e.target.closest('[data-song]'); if (so) return go('song', { id: so.dataset.song });
  const se = e.target.closest('[data-set]'); if (se) return go('set', { id: se.dataset.set });
});
const cmpTitle = (a, b) => clean(a.title || '').localeCompare(clean(b.title || ''), 'fr', { sensitivity: 'base' });
function renderSongs() {
  const q = $('#q').value.trim().toLowerCase();
  const list = [...songs.values()].sort(cmpTitle).filter(s => !q || [s.title, s.artist, s.style].join(' ').toLowerCase().includes(q));
  $('#count').textContent = songs.size + (songs.size > 1 ? ' chants' : ' chant');
  $('#grid').innerHTML = list.length ? list.map(s => `<button class="songc" data-song="${esc(s.id)}"><span class="l1"><b>${esc(clean(s.title || '') || 'Sans titre')}</b>${s.key ? `<span class="key">${esc(keyLabel(s.key))}</span>` : ''}</span><span class="meta">${esc([s.artist, s.bpm && s.bpm + ' BPM', s.sig, s.style].filter(Boolean).join(' · ') || '—')}</span>${pillsHTML(s.struct, true)}</button>`).join('')
    : `<div class="empty">${q ? 'Aucun résultat' : 'Aucun chant.<br>Touchez + pour créer la première fiche.'}</div>`;
}
function renderSets() {
  const q = $('#q').value.trim().toLowerCase(), today = todayISO();
  const list = [...sets.values()].filter(s => !q || [s.name, ...s.items.map(itemTitle)].join(' ').toLowerCase().includes(q));
  const up = list.filter(s => (s.date || '9999') >= today).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const past = list.filter(s => (s.date || '9999') < today).sort((a, b) => b.date.localeCompare(a.date));
  $('#count').textContent = sets.size + (sets.size > 1 ? ' sets' : ' set');
  const card = (s, p) => {
    const d = dParse(s.date);
    return `<button class="setc${p ? ' past' : ''}" data-set="${esc(s.id)}"><span class="dt">${d ? `<small>${d.toLocaleDateString('fr-FR', { weekday: 'short' })}</small><b>${d.getDate()}</b><small>${d.toLocaleDateString('fr-FR', { month: 'short' })}</small>` : '<b>—</b>'}</span><span class="bd"><b>${esc(clean(s.name || '') || 'Set sans nom')}</b><span>${esc(setSummary(s))}</span><span>${esc(s.items.map(itemTitle).join(' · ') || 'Aucun chant')}</span></span></button>`;
  };
  $('#grid').innerHTML = (up.length ? '<h4>À venir</h4>' + up.map(s => card(s)).join('') : '') + (past.length ? '<h4>Passés</h4>' + past.map(s => card(s, true)).join('') : '')
    || `<div class="empty">${q ? 'Aucun résultat' : 'Aucun set.<br>Touchez + pour préparer le premier.'}</div>`;
}

// ---------- Fiche d'un chant ----------
const curSong = () => { const t = topNav(); return t && t.v === 'song' ? songs.get(t.id) : null; };
function renderSong(t) {
  const s = songs.get(t.id); if (!s) { nav.pop(); return render(); }
  $('#s-title').value = s.title || ''; $('#s-artist').value = s.artist || '';
  $('#s-key').textContent = s.key ? keyLabel(s.key) : '—';
  $('#s-bpm').value = s.bpm || ''; $('#s-sig').value = s.sig || ''; $('#s-dur').value = s.dur ? fmt(s.dur) : '';
  $('#s-style').value = s.style || ''; $('#s-links').value = s.links || ''; $('#s-notes').value = s.notes || '';
  drawLinks(s); songSt.draw();
  renderRecs($('#s-recs'), s.recs, arr => { s.recs = arr; touch('songs', s); },
    () => [clean(s.title || ''), clean(s.title || '') + (s.key ? ' – ' + keyLabel(s.key) : ''), clean(s.title || '') + ' – répétition', clean(s.title || '') + ' – voix guide']);
  const used = [...sets.values()].filter(x => x.items.some(i => i.songId === s.id)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  $('#s-used').innerHTML = used.length ? used.map(x => `<button data-goset="${esc(x.id)}">${esc((dShort(x.date) ? dShort(x.date) + ' · ' : '') + (clean(x.name || '') || 'Set sans nom'))} ›</button>`).join('') : '<span>Dans aucun set pour l\'instant.</span>';
  if (t.focus) { t.focus = false; setTimeout(() => $('#s-title').focus(), 60); }
}
function drawLinks(s) {
  $('#s-linkview').innerHTML = (s.links || '').split(/\s+/).filter(u => /^https?:\/\/\S+$/i.test(u))
    .map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/i, ''))}</a>`).join('');
}
function bindSong(sel, f, ev = 'input') {
  $(sel).addEventListener(ev, () => { const s = curSong(); if (!s) return; f(s, $(sel).value); touch('songs', s); });
}
bindSong('#s-title', (s, v) => { s.title = v; });
bindSong('#s-artist', (s, v) => { s.artist = v; });
bindSong('#s-bpm', (s, v) => { s.bpm = v.replace(/\D/g, '').slice(0, 3); });
bindSong('#s-sig', (s, v) => { s.sig = v; }, 'change');
bindSong('#s-dur', (s, v) => { s.dur = parseDur(v); $('#s-dur').value = s.dur ? fmt(s.dur) : ''; }, 'change');
bindSong('#s-style', (s, v) => { s.style = v; });
$('#s-style').addEventListener('change', refreshStyles);
bindSong('#s-links', (s, v) => { s.links = v; drawLinks(s); });
bindSong('#s-notes', (s, v) => { s.notes = v; });
$('#s-key').onclick = () => {
  const s = curSong(); if (!s) return;
  keySheet(s.key, k => { s.key = k || ''; touch('songs', s); $('#s-key').textContent = k ? keyLabel(k) : '—'; });
};
const songSt = structEditor($('#s-struct'), () => (curSong() || {}).struct || [], st => { const s = curSong(); if (!s) return; s.struct = st; touch('songs', s); });
$('#s-rec').onclick = () => {
  if (rec) return stopRec();
  const s = curSong(); if (!s) return;
  recToggle(clean(s.title || '') ? clean(s.title) + (s.key ? ' – ' + keyLabel(s.key) : '') : 'Enregistrement', (id, d, title) => {
    s.recs = [...(s.recs || []), { id, d, title }]; touch('songs', s);
    if (curSong() === s) renderRecs($('#s-recs'), s.recs, arr => { s.recs = arr; touch('songs', s); }, $('#s-recs').recSuggest);
  });
};
$('#s-used').addEventListener('click', e => { const b = e.target.closest('[data-goset]'); if (b) go('set', { id: b.dataset.goset }); });
$('#s-del').onclick = () => {
  const s = curSong(); if (!s) return;
  const n = [...sets.values()].filter(x => x.items.some(i => i.songId === s.id)).length;
  ask('Supprimer ce chant de la bibliothèque ?' + (n ? ` Il est utilisé dans ${n} set${n > 1 ? 's' : ''} (son titre y restera).` : ''), async () => {
    if (rec) await stopRec();
    await removeDoc('songs', s); nav.pop(); render();
  });
};

// ---------- Un set ----------
const curSet = () => { const t = topNav(); return t && (t.v === 'set' || t.v === 'item') ? sets.get(t.id) : null; };
function renderSet(t) {
  const s = sets.get(t.id); if (!s) { nav.pop(); return render(); }
  $('#set-name').value = s.name || ''; $('#set-date').value = s.date || ''; $('#set-notes').value = s.notes || '';
  drawItems(s);
  if (t.focus) { t.focus = false; setTimeout(() => $('#set-name').focus(), 60); }
}
const ARROW = d => `<svg viewBox="0 0 24 24"><path d="${d ? 'm6 9 6 6 6-6' : 'm6 15 6-6 6 6'}"/></svg>`;
function drawItems(s) {
  $('#set-sum').textContent = setSummary(s);
  $('#set-items').innerHTML = s.items.map((it, i) => {
    const song = songs.get(it.songId), k = itemKey(it), changed = it.key && song && song.key && it.key !== song.key;
    const meta = [song && song.bpm && song.bpm + ' BPM', song && song.style, it.lead && 'Lead : ' + it.lead, it.recs && it.recs.length && '🎙 ' + it.recs.length].filter(Boolean).join(' · ');
    return `<div class="itc" data-it="${esc(it.id)}"><span class="num">${i + 1}</span><button class="main" type="button"><span class="l1"><b>${esc(itemTitle(it))}</b>${k ? `<span class="key">${esc(keyLabel(k))}${changed ? `<s>orig. ${esc(keyLabel(song.key))}</s>` : ''}</span>` : ''}</span>${meta ? `<span class="meta">${esc(meta)}</span>` : ''}${pillsHTML(itemSt(it), true)}${it.note ? `<span class="note">↳ ${esc(it.note)}</span>` : ''}</button><span class="mv"><button type="button" data-mv="-1" aria-label="Monter">${ARROW(0)}</button><button type="button" data-mv="1" aria-label="Descendre">${ARROW(1)}</button></span></div>`;
  }).join('') || '<p class="empty-st">Aucun chant pour l\'instant.</p>';
}
$('#set-items').addEventListener('click', e => {
  const card = e.target.closest('.itc'), s = curSet(); if (!card || !s) return;
  const i = s.items.findIndex(x => x.id === card.dataset.it);
  const mv = e.target.closest('[data-mv]');
  if (mv) {
    const j = i + +mv.dataset.mv; if (j < 0 || j >= s.items.length) return;
    [s.items[i], s.items[j]] = [s.items[j], s.items[i]]; touch('sets', s); drawItems(s); return;
  }
  go('item', { id: s.id, item: card.dataset.it });
});
function bindSet(sel, f, ev = 'input') {
  $(sel).addEventListener(ev, () => { const s = curSet(); if (!s) return; f(s, $(sel).value); touch('sets', s); });
}
bindSet('#set-name', (s, v) => { s.name = v; });
bindSet('#set-date', (s, v) => { s.date = v; }, 'change');
bindSet('#set-notes', (s, v) => { s.notes = v; });
$('#set-add').onclick = () => { const s = curSet(); if (s) songPicker(s); };
function songPicker(set) {
  const sh = sheet('<p>Ajouter un chant</p><input class="fld pq" placeholder="Rechercher ou taper un nouveau titre…" autocomplete="off"><div class="pick"></div><button class="cancel">Fermer</button>');
  const q = sh.querySelector('.pq'), box = sh.querySelector('.pick');
  const draw = () => {
    const v = clean(q.value).toLowerCase(), inSet = new Set(set.items.map(i => i.songId));
    const list = [...songs.values()].filter(s => clean(s.title || '') && (!v || [s.title, s.artist].join(' ').toLowerCase().includes(v))).sort(cmpTitle);
    box.innerHTML = (v && !list.some(s => clean(s.title).toLowerCase() === v) ? `<button class="create">+ Créer le chant « ${esc(clean(q.value))} »</button>` : '')
      + list.map(s => `<button data-pick="${esc(s.id)}"><b>${esc(clean(s.title))}</b>${inSet.has(s.id) ? '<em class="in">déjà dans le set</em>' : ''}${s.key ? `<span class="key">${esc(keyLabel(s.key))}</span>` : ''}</button>`).join('')
      || `<p class="empty-st">${v ? '' : 'Ta bibliothèque est vide : tape un titre pour créer un chant.'}</p>`;
  };
  q.addEventListener('input', draw); draw();
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const b = box.querySelector('button'); if (b) b.click(); } });
  box.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    let song;
    if (b.classList.contains('create')) { song = newSong(clean(q.value)); await put('songs', song); }
    else song = songs.get(b.dataset.pick);
    if (!song) return;
    set.items.push({ id: uid(), songId: song.id, title: clean(song.title), key: null, struct: null, lead: '', note: '', recs: [] });
    touch('sets', set); drawItems(set);
    toast('« ' + clean(song.title) + ' » ajouté au set');
    q.value = ''; draw();
  });
}
$('#set-dup').onclick = async () => {
  const s = curSet(); if (!s) return;
  await flush();
  const c = JSON.parse(JSON.stringify(s));
  delete c.synced; delete c.deleted;
  Object.assign(c, { id: uid(), name: (clean(s.name || '') || 'Set') + ' (copie)', date: todayISO(), updated: Date.now() });
  c.items = c.items.map(it => ({ ...it, id: uid(), recs: [] }));
  sets.set(c.id, c); await put('sets', c); syncSoon();
  nav.pop(); nav.push({ v: 'set', id: c.id }); render(true);
  toast('Set dupliqué (sans les enregistrements)');
};
$('#set-del').onclick = () => {
  const s = curSet(); if (!s) return;
  ask('Supprimer ce set ? Ses enregistrements seront supprimés aussi.', async () => { await removeDoc('sets', s); nav.pop(); render(); });
};

// ---------- Un chant dans un set (réglages du jour) ----------
const curItem = () => {
  const t = topNav(); if (!t || t.v !== 'item') return null;
  const set = sets.get(t.id), it = set && set.items.find(i => i.id === t.item);
  return it ? { set, it, song: songs.get(it.songId) } : null;
};
function renderItem() {
  const c = curItem(); if (!c) { nav.pop(); return render(); }
  const { set, it, song } = c;
  $('#it-num').textContent = set.items.indexOf(it) + 1;
  $('#it-title').textContent = itemTitle(it);
  $('#it-open').classList.toggle('hidden', !song);
  $('#it-info').textContent = song ? [song.key && 'Tonalité d\'origine : ' + keyLabel(song.key), song.bpm && song.bpm + ' BPM', song.sig, song.style].filter(Boolean).join(' · ') : 'Ce chant a été supprimé de la bibliothèque.';
  drawItemKey(c);
  $('#it-lead').value = it.lead || ''; $('#it-note').value = it.note || '';
  $('#it-reset').classList.toggle('hidden', !it.struct);
  itSt.draw();
  renderRecs($('#it-recs'), it.recs, arr => { it.recs = arr; touch('sets', set); }, () => itemRecTitles(c));
}
function drawItemKey({ it, song }) {
  $('#it-key').textContent = it.key ? keyLabel(it.key) + (song && song.key && song.key !== it.key ? ' (orig. ' + keyLabel(song.key) + ')' : '') : song && song.key ? keyLabel(song.key) : '—';
}
function itemRecTitles({ set, it }) {
  const t = itemTitle(it), k = itemKey(it) ? keyLabel(itemKey(it)) : '', d = dShort(set.date);
  return [[t, k, d].filter(Boolean).join(' – '), t, [t, k].filter(Boolean).join(' – '), [t, d].filter(Boolean).join(' – '), clean(set.name || '') && t + ' – ' + clean(set.name)];
}
const itSt = structEditor($('#it-struct'), () => { const c = curItem(); return c ? itemSt(c.it) : []; },
  st => { const c = curItem(); if (!c) return; c.it.struct = st; touch('sets', c.set); $('#it-reset').classList.remove('hidden'); });
$('#it-reset').onclick = () => { const c = curItem(); if (!c) return; c.it.struct = null; touch('sets', c.set); itSt.draw(); $('#it-reset').classList.add('hidden'); };
$('#it-key').onclick = () => {
  const c = curItem(); if (!c) return;
  keySheet(itemKey(c.it), k => { c.it.key = k && !(c.song && k === c.song.key) ? k : null; touch('sets', c.set); drawItemKey(c); },
    c.song && c.song.key ? 'Comme le chant (' + keyLabel(c.song.key) + ')' : 'Aucune');
};
for (const [sel, f] of [['#it-lead', (it, v) => { it.lead = v; }], ['#it-note', (it, v) => { it.note = v; }]])
  $(sel).addEventListener('input', () => { const c = curItem(); if (!c) return; f(c.it, $(sel).value); touch('sets', c.set); });
$('#it-open').onclick = () => { const c = curItem(); if (c && c.song) go('song', { id: c.song.id }); };
$('#it-del').onclick = () => {
  const c = curItem(); if (!c) return;
  ask('Retirer ce chant du set ?' + ((c.it.recs || []).length ? ' Ses enregistrements seront supprimés.' : ''), async () => {
    if (rec) await stopRec();
    const ids = (c.it.recs || []).map(r => r.id);
    for (const id of ids) await delAudio(id);
    cloudRemove(ids);
    c.set.items = c.set.items.filter(x => x !== c.it); touch('sets', c.set);
    nav.pop(); render();
  });
};
$('#it-rec').onclick = () => {
  if (rec) return stopRec();
  const c = curItem(); if (!c) return;
  recToggle(itemRecTitles(c)[0], (id, d, title) => {
    c.it.recs = [...(c.it.recs || []), { id, d, title }]; touch('sets', c.set);
    const now = curItem();
    if (now && now.it === c.it) renderRecs($('#it-recs'), c.it.recs, arr => { c.it.recs = arr; touch('sets', c.set); }, () => itemRecTitles(c));
  });
};
await loadDocs();
render();
})();
