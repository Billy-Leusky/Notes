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
    const r = indexedDB.open('notes-app', 3);
    r.onupgradeneeded = () => { const d = r.result; for (const n of ['notes', 'audio', 'songs', 'sets', 'items', 'recs', 'pnotes']) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' }); };
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

let nav = [], songs = new Map(), sets = new Map(), items = new Map(), recDocs = new Map(), pnotes = new Map();
let touched = false, notes = [], cur = null, dirty = false, saveT, range = null, playing = null, rec = null, urls = {}, blobs = {};

// ---------- Liste ----------
const renderList = () => renderTab();
async function renderNotes() {
  notes = (await allNotes()).filter(n => !n.deleted).sort((a, b) => (b.edited || 0) - (a.edited || 0));
  const q = $('#q').value.trim().toLowerCase();
  const list = notes.filter(n => !q || ((n.title || '') + ' ' + (n.text || '')).toLowerCase().includes(q));
  $('#count').textContent = notes.length + (notes.length > 1 ? ' notes' : ' note');
  html($('#grid'), list.length ? list.map(n => `<button class="card" data-id="${esc(n.id)}"><b>${esc(clean(n.title || '') || 'Sans titre')}</b><span>${esc(n.text || '')}</span><small>${n.recs ? I.mic + esc(n.recs) + ' · ' : ''}${esc(new Date(n.edited || Date.now()).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }))}</small></button>`).join('')
    : `<div class="empty">${q ? 'Aucun résultat' : 'Aucune note.<br>Touchez + pour commencer.'}</div>`);
}
$('#q').addEventListener('input', renderList);
$('#grid').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) openNote(notes.find(n => n.id === c.dataset.id)); });
const newNote = () => openNote({ id: uid(), title: '', html: '', text: '', recs: 0, edited: Date.now(), team: null, _ts: {}, ver: 0, seq: 0 });

// ---------- Éditeur ----------
async function openNote(n) {
  cur = n; dirty = false; touched = false; range = null;
  $('#title').value = n.title || '';
  body.innerHTML = n.html || '';
  $('#date').textContent = dfmt(n.edited || Date.now());
  showView('editor');
  $('.scroller').scrollTop = 0;
  if (!n.title && !n.html) setTimeout(() => { const a = document.activeElement; if (cur === n && (!a || a === document.body)) $('#title').focus(); }, 50);
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
  if (!cur || !dirty) return;
  captureNote();
}
// Contenu actuel de l'éditeur (lecteurs audio remis à zéro, pour comparer et enregistrer)
function noteDomHtml() { const a = body.cloneNode(true); a.querySelectorAll('.rec').forEach(resetChip); return a.innerHTML; }
function captureNote() {
  clearTimeout(saveT);
  if (!cur || $('#editor').classList.contains('hidden')) return;
  dirty = false;
  const b = body.cloneNode(true); b.querySelectorAll('.rec').forEach(r => r.remove());
  b.querySelectorAll('div,p,li,br').forEach(e => e.before(' '));
  // Seuls les champs réellement modifiés sont horodatés (fusion champ par champ)
  const v = { title: $('#title').value, html: noteDomHtml(), text: b.textContent.replace(/\s+/g, ' ').trim(), recs: body.querySelectorAll('.rec').length };
  const f = {}; for (const k in v) if (cur[k] !== v[k]) f[k] = v[k];
  if (!Object.keys(f).length) return;
  f.edited = Date.now();
  edit('note', cur, f);
  $('#date').textContent = dfmt(cur.edited);
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
  if (cur && !clean(cur.title || '') && !(cur.text || '').trim() && !cur.recs && !$('#title').value.trim() && !body.textContent.trim() && !body.querySelector('.rec')) await removeNote(cur, []);
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
const recChanged = cont => { sched(); save(); };
document.addEventListener('click', e => {
  const c = e.target.closest('.rec'); if (!c) return;
  const cont = c.closest('.recs') || body;
  e.preventDefault();
  if (c.classList.contains('ro') && (e.target.closest('.nm') || e.target.closest('.x'))) { toast('Seuls son auteur et les responsables peuvent modifier cet enregistrement.'); return; }
  if (e.target.closest('.pbadge')) {
    const r = recDocs.get(c.dataset.id); if (!r) return;
    if (c.classList.contains('ro')) { toast('Seuls son auteur et les responsables peuvent modifier cet enregistrement.'); return; }
    const it = items.get(r.parentId), song = songs.get(recSong(r));
    partSheet(it ? itemSt(it) : song ? song.struct : [], 'Cet enregistrement est…', part => {
      const f = { part: part || null };
      if (part && r.official) f.official = false; // l'officiel est toujours un chant complet
      // Le titre suit la partie (« Oh Happy Day – C1 – 6 déc. » → « Oh Happy Day – C2 – 6 déc. »)
      let t = r.title || '';
      if (r.part) { const old = partLabel(r.part).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); t = t.replace(new RegExp(' – ' + old + '( – |$)'), (m, sep) => sep ? ' – ' : ''); }
      if (part) t = withPart(t, part);
      if (t !== r.title) f.title = t;
      edit('rec', r, f); refreshUI(true);
    }, r.part || 'full');
    return;
  }
  if (e.target.closest('.pick')) {
    const r = recDocs.get(c.dataset.id), it = r && items.get(r.parentId); if (!it) return;
    if (!canEdit(it.team)) { toast('Seuls les responsables choisissent l\'enregistrement écouté.'); return; }
    edit('item', it, { listenRec: r.id }); refreshUI(true);
    toast('🎧 C\'est cet enregistrement qui sera écouté dans le set');
    return;
  }
  if (e.target.closest('.star')) {
    const r = recDocs.get(c.dataset.id); if (!r) return;
    if (!canEdit(r.team)) { toast('Seuls les responsables choisissent l\'enregistrement officiel.'); return; }
    if (r.part) { toast('L\'enregistrement officiel doit être le chant complet.'); return; }
    setOfficial(r, !r.official);
    toast(r.official ? '★ Enregistrement officiel du chant' : 'Ce n\'est plus l\'enregistrement officiel');
    return;
  }
  if (e.target.closest('.wk')) { stopPlay(); workSheet(c.dataset.id, c.dataset.title || 'Enregistrement'); return; }
  if (e.target.closest('.nm')) renameRec(c, cont);
  else if (e.target.closest('.sh')) shareRec(c);
  else if (e.target.closest('.x')) {
    ask('Supprimer cet enregistrement ?', async () => {
      if (playing && playing.chip === c) stopPlay();
      if (cont !== body) { recOp(c, 'remove'); return; }
      c.remove(); await delAudio(c.dataset.id); cloudRemove([c.dataset.id]); recChanged(cont);
    });
  } else if (e.target.closest('.pl')) togglePlay(c);
});

// ---------- Audio ----------
function chip(id, d, title) {
  const c = document.createElement('div');
  c.className = 'rec'; c.contentEditable = 'false'; c.dataset.id = id; c.dataset.d = d.toFixed(1);
  c.innerHTML = `<button class="pl" type="button" aria-label="Lire">${I.play}</button><span class="mid"><button class="nm" type="button" aria-label="Renommer"></button><span class="row"><span class="tr"><i></i></span><span class="t">${fmt(d)}</span></span></span><button class="wk" type="button" aria-label="Travailler (vitesse, boucle)"><svg viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg></button><button class="sh" type="button" aria-label="Partager">${I.share}</button><button class="x" type="button" aria-label="Supprimer">${I.x}</button>`;
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
  const done = t => { setTitle(c, t); if (cont === body) recChanged(cont); else recOp(c, 'rename', t); s.remove(); };
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
    : /ogg|opus/.test(type) ? [['audio/ogg', 'ogg']]
    : /mpeg|mp3/.test(type) ? [['audio/mpeg', 'mp3'], ['audio/mp3', 'mp3']]
    : /wav/.test(type) ? [['audio/wav', 'wav'], ['audio/x-wav', 'wav']]
    : /flac/.test(type) ? [['audio/flac', 'flac']]
    : /aac/.test(type) ? [['audio/aac', 'aac'], ['audio/x-m4a', 'm4a']]
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

// =====================================================================
// ==========  Données partagées & synchronisation (Supabase)  ==========
// =====================================================================
// Chaque document (note, chant, set, élément de set, enregistrement, note perso) est une ligne
// de la table « docs ». Pour gérer les modifications simultanées (plusieurs appareils, plusieurs
// personnes), chaque champ garde l'heure de sa dernière modification (_ts) : à la fusion, champ
// par champ, la modification la plus récente gagne. La fusion est faite de façon atomique sur le
// serveur (fonction merge_doc) et de la même façon sur chaque appareil.
// Les éléments d'un set et les enregistrements sont des documents séparés : deux personnes qui
// modifient deux chants différents du même set, ou ajoutent chacune un enregistrement, ne se
// gênent pas. Une suppression est définitive (« pierre tombale » deleted).
const sb = SB_URL && SB_KEY && window.supabase ? window.supabase.createClient(SB_URL, SB_KEY) : null;
const KIND_STORE = { note: 'notes', song: 'songs', set: 'sets', item: 'items', rec: 'recs', pnote: 'pnotes' };
const META = ['id', 'team', 'ver', 'dirty', 'deleted', 'seq', 'uid', 'base'];
const MEM = { song: songs, set: sets, item: items, rec: recDocs, pnote: pnotes };
let user = null, clockOff = 0, syncing = null, syncT, pushT, pushing = null, pushAgain = false;
let lastSync = 0, syncErr = '', audioErr = '';
const now = () => Date.now() + clockOff;
const dataOf = o => { const d = {}; for (const k in o) if (!META.includes(k)) d[k] = o[k]; return d; };
const memOf = (kind, id) => kind === 'note' ? (cur && cur.id === id ? cur : null) : (MEM[kind] && MEM[kind].get(id)) || null;
const recIdsOf = html => { const t = document.createElement('template'); t.innerHTML = html || ''; return [...t.content.querySelectorAll('.rec')].map(r => r.dataset.id); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Contenu d'un document (sans métadonnées ni horodatages)
const fieldsOf = o => { const d = {}; for (const k in o) if (!META.includes(k) && k !== '_ts') d[k] = o[k]; return d; };
// Fusion de texte à trois versions (comme les éditeurs collaboratifs) : on applique au texte local
// les changements faits ailleurs depuis la version commune « base ». Les deux saisies sont gardées.
let dmp = null;
function merge3(base, local, remote) {
  if (local === remote || remote === base) return local;
  if (local === base) return remote;
  if (!window.diff_match_patch) return remote;
  dmp = dmp || new diff_match_patch();
  dmp.Match_Threshold = 0.5; dmp.Match_Distance = 1000; dmp.Patch_DeleteThreshold = 0.5;
  return dmp.patch_apply(dmp.patch_make(base, remote), local)[0];
}
// Fusionne la version du serveur r dans le document local o (qui a des modifications non envoyées).
// Champ par champ : changé d'un seul côté → on garde ce changement ; texte changé des deux côtés →
// fusion caractère par caractère ; autre valeur changée des deux côtés → la plus récente gagne.
// Renvoie true s'il reste des différences locales à envoyer.
// Textes libres fusionnés caractère par caractère ; les champs courts (titre de chant, artiste,
// style, lead…) gardent la valeur la plus récente (fusionner « Pop » et « Gospel » n'aurait pas de sens).
const MERGE_TEXT = { note: ['title', 'html', 'text'], song: ['notes', 'links'], set: ['notes'], item: ['note'], pnote: ['text'] };
function mergeFields(o, r, kind) {
  const base = o.base, ts = { ...(o._ts || {}) }, rts = r._ts || {};
  const keys = new Set([...Object.keys(fieldsOf(o)), ...Object.keys(fieldsOf(r))]);
  let differs = false;
  for (const k of keys) {
    const l = o[k], rv = r[k], b = base ? base[k] : undefined;
    let v;
    if (same(l, rv)) v = l;
    else if (base && same(l, b)) v = rv;
    else if (base && same(rv, b)) v = l;
    else if (base && (MERGE_TEXT[kind] || []).includes(k) && typeof l === 'string' && typeof rv === 'string' && (b == null || typeof b === 'string')) v = merge3(b || '', l, rv);
    else v = (rts[k] || 0) > (ts[k] || 0) ? rv : l;
    if (v !== undefined) o[k] = v; else delete o[k];
    ts[k] = Math.max(ts[k] || 0, rts[k] || 0);
    if (!same(v, rv)) differs = true;
  }
  // Transfert vers une équipe pas encore envoyé : on le garde (et il reste à envoyer)
  if (o.team && o.team !== r.team) differs = true; else o.team = r.team;
  o._ts = ts; o.base = fieldsOf(r); o.ver = r.ver; o.uid = r.uid;
  return differs;
}
const errText = e => (e && ((e.name && e.name !== 'Error' ? e.name + ' : ' : '') + (e.message || e.code || ''))) || String(e);

// ---------- Écriture locale ----------
// Les modifications sont enregistrées sur l'appareil après 250 ms (au plus tard 1 s pendant une
// saisie continue), puis envoyées aussitôt.
const pend = new Map(); let pendT, pendSince = 0;
function storeLocal(kind, o) {
  pend.set(kind + ':' + o.id, [kind, o]);
  if (!pendSince) pendSince = Date.now();
  clearTimeout(pendT);
  pendT = setTimeout(flush, Date.now() - pendSince > 1000 ? 0 : 250);
}
async function flush() {
  clearTimeout(pendT); pendSince = 0;
  const ps = [...pend.values()]; pend.clear();
  for (const [kind, o] of ps) {
    if (o.deleted && !o.ver) await del(KIND_STORE[kind], o.id); // jamais envoyé : rien à propager
    else await put(KIND_STORE[kind], o);
  }
  if (ps.length) pushSoon();
}
// Modifie des champs d'un document (chaque champ modifié est horodaté)
function edit(kind, o, fields) {
  const t = now(); o._ts = { ...(o._ts || {}) };
  for (const k in fields) { o[k] = fields[k]; o._ts[k] = t; }
  if (o.team && user) { o._by = user.id; o._ts._by = t; }
  o.dirty = true; o.seq = (o.seq || 0) + 1;
  storeLocal(kind, o);
  return o;
}
function create(kind, fields, team = null) {
  const t = now(), o = { id: uid(), ...fields, team: team || null, _ts: {}, ver: 0, dirty: true, seq: 1 };
  for (const k in fields) o._ts[k] = t;
  if (o.team && user) { o._by = user.id; o._ts._by = t; }
  if (MEM[kind]) MEM[kind].set(o.id, o);
  storeLocal(kind, o);
  return o;
}
function remove(kind, o) {
  o.deleted = true; o.dirty = true; o.seq = (o.seq || 0) + 1;
  if (MEM[kind]) MEM[kind].delete(o.id);
  if (kind === 'rec') { delAudio(o.id); if (user && (!o.owner || o.owner === user.id)) cloudRemove([o.id]); }
  storeLocal(kind, o);
}
function cloudRemove(ids) {
  if (sb && user && ids.length) sb.storage.from('audio').remove(ids.map(id => user.id + '/' + id)).catch(() => {});
}
async function removeNote(n, recIds) {
  for (const id of recIds) await delAudio(id);
  cloudRemove(recIds);
  remove('note', n);
}

// ---------- Réception d'un document du serveur ----------
// Ancien format (avant la fusion par champ) : on le convertit à la volée.
function normalize(row) {
  const d = { ...(row.data || {}) };
  const ts = d._ts ? { ...d._ts } : {};
  if (!d._ts) for (const k in d) ts[k] = row.updated;
  delete d._ts;
  if (row.kind === 'set' && Array.isArray(d.items)) {
    d.items.forEach((it, i) => {
      if (!it || !it.id || items.has(it.id)) return;
      const t = row.updated, f = { setId: row.id, songId: it.songId, title: it.title || '', key: it.key || null, struct: it.struct || null, lead: it.lead || '', note: it.note || '', pos: i };
      const o = { id: it.id, ...f, team: row.team_id || null, _ts: Object.fromEntries(Object.keys(f).map(k => [k, t])), ver: 0, dirty: true, seq: 1 };
      items.set(o.id, o); storeLocal('item', o);
      for (const r of it.recs || []) legacyRec(r, it.id, row);
    });
  }
  if (row.kind === 'song' && Array.isArray(d.recs)) for (const r of d.recs) legacyRec(r, row.id, row);
  if (row.kind === 'set') delete d.items;
  if (row.kind === 'song') delete d.recs;
  return { ...d, id: row.id, team: row.team_id || null, ver: row.updated, deleted: !!row.deleted, uid: row.user_id, _ts: ts };
}
function legacyRec(r, parentId, row) {
  if (!r || !r.id || recDocs.has(r.id)) return;
  const t = row.updated, f = { parentId, title: r.title || '', d: r.d || 0, owner: row.user_id, at: t };
  const o = { id: r.id, ...f, team: row.team_id || null, _ts: Object.fromEntries(Object.keys(f).map(k => [k, t])), ver: 0, dirty: true, seq: 1 };
  recDocs.set(o.id, o); storeLocal('rec', o);
}
const changedKinds = new Set(); let refreshT;
// Documents en cours d'envoi : les versions reçues pendant l'envoi sont mises en attente et
// appliquées après la réponse du serveur (sinon notre propre envoi, revenu par le temps réel
// avant la confirmation, serait pris pour une modification d'ailleurs et fusionné deux fois).
const sending = new Map();
async function applyRow(row) {
  const kind = row.kind, st = KIND_STORE[kind]; if (!st || !row.id) return false;
  if (sending.has(row.id)) { sending.get(row.id).push(row); return false; }
  // Mot en cours de composition (clavier de téléphone) : on applique après sa validation
  if (composing) { deferred.push(row); return false; }
  let o = memOf(kind, row.id) || await get(st, row.id);
  if (o && o.ver >= row.updated && !(row.deleted && !o.deleted)) return false; // déjà à jour
  const r = normalize(row);
  if (r.deleted) {
    if (o) for (const id of kind === 'rec' ? [o.id] : kind === 'note' ? recIdsOf(o.html) : []) delAudio(id);
    if (MEM[kind]) MEM[kind].delete(row.id);
    pend.delete(kind + ':' + row.id);
    await del(st, row.id);
    if (kind === 'note' && cur && cur.id === row.id) { cur = null; showList(); toast('Cette note a été supprimée sur un autre appareil.'); }
    changedKinds.add(kind); clearTimeout(refreshT); refreshT = setTimeout(refreshUI, 30);
    return true;
  }
  // Note ouverte : on prend d'abord en compte ce qui vient d'être tapé (pas encore enregistré)
  if (kind === 'note' && cur && cur.id === row.id) { captureNote(); o = cur; }
  else if (o && MEM[kind] && MEM[kind].get(row.id)) o = MEM[kind].get(row.id);
  let n;
  if (!o || !o.dirty) {
    n = { ...r, base: fieldsOf(r), dirty: false, seq: o ? o.seq || 0 : 0 };
    if (o) { for (const k of Object.keys(o)) if (!(k in n)) delete o[k]; Object.assign(o, n); n = o; }
  } else {
    n = o;
    n.dirty = mergeFields(n, r, kind);
    if (n.dirty) pushSoon(50);
  }
  if (MEM[kind] && !MEM[kind].has(row.id)) MEM[kind].set(row.id, n);
  // Mise à jour de l'éditeur tout de suite, sans attente depuis la capture de la frappe :
  // sinon une touche tapée pendant l'attente serait effacée par la mise à jour.
  if (kind === 'note' && cur === n) refreshNoteEditor();
  await put(st, n);
  if (kind === 'rec' || (kind === 'note' && recIdsOf(n.html).length)) audioSoon();
  changedKinds.add(kind);
  clearTimeout(refreshT); refreshT = setTimeout(refreshUI, 30);
  return true;
}
// Note ouverte modifiée ailleurs (et pas en cours d'écriture ici) : on met à jour sans fermer
// Saisie en cours de composition (clavier Android, suggestions, accents) : on attend la fin du mot
let composing = false, pendingRefresh = false, deferred = [];
document.addEventListener('compositionstart', () => { composing = true; });
document.addEventListener('compositionend', () => {
  composing = false;
  // Après l'événement « input » du mot validé (qui met à jour le document), on applique ce qui a été reçu
  setTimeout(async () => {
    const q = deferred; deferred = [];
    for (const r of q) await applyRow(r);
    if (pendingRefresh) { pendingRefresh = false; refreshNoteEditor(); refreshUI(true); }
  }, 0);
});
function refreshNoteEditor() {
  if (!cur || $('#editor').classList.contains('hidden')) return;
  if (composing) { pendingRefresh = true; return; }
  setV('#title', cur.title || '');
  if (noteDomHtml() !== (cur.html || '')) {
    const focused = document.activeElement === body || body.contains(document.activeElement);
    const sel = getSelection();
    let off = null;
    if (focused && sel.rangeCount && body.contains(sel.anchorNode)) { const r = document.createRange(); r.setStart(body, 0); r.setEnd(sel.anchorNode, sel.anchorOffset); off = r.toString().length; }
    const oldText = body.textContent;
    const playingId = playing && playing.chip.isConnected ? playing.chip.dataset.id : null;
    body.innerHTML = cur.html || '';
    for (const old of body.querySelectorAll('.rec')) {
      if (old.dataset.id === playingId) { old.replaceWith(playing.chip); continue; }
      const c = chip(old.dataset.id, +old.dataset.d || 0, old.dataset.title); old.replaceWith(c); loadAudio(c.dataset.id);
    }
    if (off != null) {
      // Le curseur reste au même endroit du texte, décalé si du texte a été ajouté avant lui
      dmp = dmp || (window.diff_match_patch ? new diff_match_patch() : null);
      const pos = dmp ? dmp.diff_xIndex(dmp.diff_main(oldText, body.textContent), off) : off;
      placeCaretAt(pos);
    }
  }
  $('#date').textContent = dfmt(cur.edited || Date.now());
}
function placeCaretAt(pos) {
  const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let n, left = pos;
  while ((n = w.nextNode())) {
    if (n.parentNode.closest && n.parentNode.closest('.rec')) { left -= n.data.length; if (left < 0) left = 0; continue; }
    if (left <= n.data.length) { caretAt(n, left); return; }
    left -= n.data.length;
  }
  const r = document.createRange(); r.selectNodeContents(body); r.collapse(false);
  getSelection().removeAllRanges(); getSelection().addRange(r); range = r.cloneRange();
}

// ---------- Envoi ----------
function pushSoon(ms = 120) { if (!sb || !user) return; clearTimeout(pushT); pushT = setTimeout(push, ms); }
function push() {
  if (!sb || !user || !navigator.onLine) return Promise.resolve();
  if (pushing) { pushAgain = true; return pushing; }
  pushing = (async () => {
    await flush();
    const todo = [];
    for (const [kind, st] of Object.entries(KIND_STORE)) for (const o of await all(st)) if (o.dirty) todo.push([kind, memOf(kind, o.id) || o]);
    for (const [kind, o] of todo) {
      // Le serveur n'accepte l'envoi que s'il part de sa dernière version ; sinon on fusionne
      // avec sa version actuelle et on renvoie (quelques essais au plus).
      for (let attempt = 0; attempt < 6 && o.dirty; attempt++) {
        if (kind === 'note' && cur === o) captureNote();
        if (kind === 'rec' && !o.owner) edit('rec', o, { owner: user.id });
        const seq = o.seq;
        await uploadAudio(kind, o);
        const t0 = Date.now();
        sending.set(o.id, []);
        let res, error;
        try { ({ data: res, error } = await sb.rpc('cas_doc', { p_id: o.id, p_kind: kind, p_team: o.team || null, p_data: dataOf(o), p_expect: o.ver || 0, p_deleted: !!o.deleted })); }
        catch (e) { error = e; }
        const queued = sending.get(o.id) || []; sending.delete(o.id);
        const replay = async () => { for (const q of queued) await applyRow(q); };
        if (error) {
          await replay();
          // Refus (droits) : on abandonne la modification locale et on reprend la version du serveur
          if (/row-level security|permission|42501|23505|duplicate key/i.test(error.message + ' ' + error.code)) { await discard(kind, o); break; }
          throw error;
        }
        const row = res.row;
        // Décalage d'horloge de cet appareil (pour horodater les champs à l'heure du serveur)
        const off = row.updated - Math.round((t0 + Date.now()) / 2);
        if (Math.abs(off - clockOff) > 1500) clockOff = off;
        if (res.ok) {
          if (o.deleted || row.deleted) { if (MEM[kind]) MEM[kind].delete(o.id); await del(KIND_STORE[kind], o.id); o.dirty = false; break; }
          o.ver = row.updated; o.base = fieldsOf(normalize(row)); o.uid = row.user_id;
          if (o.seq === seq) o.dirty = false;
          await put(KIND_STORE[kind], o);
        } else {
          await applyRow(row); // conflit : fusion avec la version du serveur, puis nouvel essai
        }
        await replay();
      }
    }
    lastSync = Date.now(); syncErr = '';
  })().catch(e => { syncErr = errText(e); console.warn('envoi', e); })
    .finally(() => { pushing = null; syncUI(); if (pushAgain) { pushAgain = false; pushSoon(); } });
  syncUI();
  return pushing;
}
async function discard(kind, o) {
  toast('Modification refusée : seuls les responsables de l\'équipe peuvent modifier cet élément.');
  o.dirty = false; o.ver = 0;
  const { data } = await sb.from('docs').select('id,kind,team_id,user_id,data,updated,deleted').eq('id', o.id).maybeSingle();
  if (data) await applyRow(data);
  else { if (MEM[kind]) MEM[kind].delete(o.id); await del(KIND_STORE[kind], o.id); refreshUI(); }
}
async function uploadAudio(kind, o) {
  const ids = o.deleted ? [] : kind === 'note' ? recIdsOf(o.html) : kind === 'rec' && o.owner === user.id ? [o.id] : [];
  for (const id of ids) {
    try {
      const a = await getAudio(id);
      if (!a || a.up) continue;
      const { error } = await sb.storage.from('audio').upload(user.id + '/' + id, a.blob, { upsert: true, contentType: baseType(a.blob.type) });
      if (error) throw error;
      await putAudio({ ...a, up: true });
    } catch (e) { audioErr = errText(e); console.warn('audio', id, e); }
  }
}

// ---------- Réception (rattrapage) ----------
// Au démarrage, au retour dans l'app et toutes les 60 s : on récupère seulement ce qui a changé
// depuis la dernière fois. Le reste du temps, le temps réel apporte les modifications.
async function pull(full) {
  const key = 'pull:' + user.id;
  let since = full ? 0 : +pref(key, 0);
  for (let guard = 0; guard < 50; guard++) {
    const { data, error } = await sb.from('docs').select('id,kind,team_id,user_id,data,updated,deleted').gte('updated', since).order('updated').limit(500);
    if (error) throw error;
    for (const row of data) await applyRow(row);
    if (data.length) { since = data[data.length - 1].updated; setPref(key, since); }
    if (data.length < 500) break;
  }
}
const audioFail = new Map(); let audioT;
// Un enregistrement reçu en temps réel : on télécharge son audio aussitôt
function audioSoon() { if (!sb || !user) return; clearTimeout(audioT); audioT = setTimeout(() => fetchMissingAudio().catch(() => {}), 300); }
async function fetchMissingAudio() {
  const want = [];
  for (const n of await all('notes')) if (!n.deleted) for (const id of recIdsOf(n.html)) want.push([id, user.id]);
  for (const r of recDocs.values()) want.push([r.id, r.owner || r.uid || user.id]);
  for (const [id, owner] of want) {
    if (Date.now() - (audioFail.get(id) || 0) < 60000) continue;
    try {
      if (await getAudio(id)) continue;
      const { data, error } = await sb.storage.from('audio').download(owner + '/' + id);
      if (error) throw error;
      if (data) {
        await putAudio({ id, blob: new Blob([await data.arrayBuffer()], { type: baseType(data.type) }), d: 0, up: true });
        audioFail.delete(id);
        if (document.querySelector(`.rec[data-id="${CSS.escape(id)}"]`)) loadAudio(id);
      }
    } catch (e) { audioFail.set(id, Date.now()); audioErr = errText(e); console.warn('audio', id, e); }
  }
}
function syncSoon(ms = 300) { if (!sb || !user) return; clearTimeout(syncT); syncT = setTimeout(() => sync(), ms); }
let wantFull = false;
function sync(full) {
  if (!sb || !user || !navigator.onLine) { syncUI(); return Promise.resolve(); }
  // Une synchro est déjà en cours : on en relance une complète juste après si besoin
  // (ex. on vient de rejoindre une équipe : il faut récupérer tous ses documents)
  if (syncing) { if (full) wantFull = true; return syncing.then(() => { if (wantFull) { wantFull = false; return sync(true); } }); }
  audioErr = '';
  syncing = (async () => { await push(); await pull(full); await push(); await fetchMissingAudio(); lastSync = Date.now(); syncErr = ''; })()
    .catch(e => { syncErr = errText(e); console.warn('sync', e); })
    .finally(() => { syncing = null; syncUI(); });
  syncUI();
  return syncing;
}
function syncUI() {
  const c = $('#cloud');
  c.classList.toggle('on', !!user); c.classList.toggle('busy', !!(syncing || pushing)); c.classList.toggle('err', !!(user && syncErr));
  $('#sync').textContent = !user ? '' : syncErr ? '· erreur de synchro' : !navigator.onLine ? '· hors ligne' : lastSync ? '· synchronisé' : '';
}

// ---------- Temps réel ----------
let rt = null, rowQ = Promise.resolve();
function live() {
  if (rt) { try { sb.removeChannel(rt); } catch (e) {} rt = null; }
  if (!user) return;
  try {
    rt = sb.channel('sync-' + user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, p => {
        const row = p.new;
        if (!row || !row.id) return;
        if (!('data' in row)) return syncSoon(100);
        rowQ = rowQ.then(() => applyRow(row)).catch(e => console.warn('temps réel', e));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, () => loadTeams(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => loadTeams())
      .subscribe(st => { if (st === 'SUBSCRIBED') syncSoon(50); });
  } catch (e) { rt = null; console.warn('temps réel indisponible', e); } // la synchro classique continue
}

// ---------- Fenêtre « Réglages et synchronisation » ----------
function cloudSheet() {
  const s = document.createElement('div'); s.className = 'sheet';
  if (!sb) {
    s.innerHTML = '<div><p>Synchronisation</p><small>' + (SB_URL ? 'Service de synchronisation injoignable. Vérifie ta connexion Internet.' : 'La synchronisation n\'est pas encore configurée.') + '</small><button class="cancel">Fermer</button></div>';
  } else if (user) {
    s.innerHTML = '<div><p>Synchronisation</p><small class="who"></small><small class="st"></small><button class="ok now">Synchroniser maintenant</button><button class="alt out">Se déconnecter</button><button class="cancel">Fermer</button></div>';
    s.querySelector('.who').textContent = 'Connecté : ' + user.email;
    s.querySelector('.st').textContent = (syncErr ? 'Erreur : ' + syncErr : lastSync ? 'Dernière synchro : ' + new Date(lastSync).toLocaleString('fr-FR') : '') + (audioErr ? ' — Audio non transféré (réessai automatique) : ' + audioErr : '');
  } else {
    s.innerHTML = '<div><p>Synchroniser mes notes</p><small>Connecte-toi avec le même compte sur chaque appareil (téléphone, tablette…). Il faut aussi un compte pour travailler en équipe.</small><input class="em" type="email" placeholder="E-mail" autocomplete="email"><input class="pw" type="password" placeholder="Mot de passe (6 caractères min.)" autocomplete="current-password"><button class="ok in">Se connecter</button><button class="alt up">Créer un compte</button><button class="cancel">Annuler</button></div>';
  }
  s.firstChild.insertAdjacentHTML('afterbegin', '<p>Réglages</p><small>Notation des tonalités</small><div class="seg"><button data-n="fr">Do Ré Mi</button><button data-n="en">C D E</button></div>');
  const markN = () => s.querySelectorAll('[data-n]').forEach(x => x.classList.toggle('on', x.dataset.n === notation));
  markN();
  s.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (e.target === s || (b && b.classList.contains('cancel'))) { s.remove(); return; }
    if (!b) return;
    if (b.dataset.n) { notation = b.dataset.n; setPref('notation', notation); markN(); render(); return; }
    if (b.classList.contains('now')) { s.remove(); await sync(true); toast(syncErr ? 'Erreur de synchro : ' + syncErr : 'Tout est synchronisé'); return; }
    if (b.classList.contains('out')) { await flush(); await sb.auth.signOut(); s.remove(); toast('Déconnecté. Tes données perso restent sur cet appareil.'); return; }
    const email = s.querySelector('.em').value.trim(), password = s.querySelector('.pw').value;
    if (!email || password.length < 6) { toast('E-mail et mot de passe (6 caractères min.) requis'); return; }
    b.disabled = true;
    let { data, error } = b.classList.contains('up') ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }) : await sb.auth.signInWithPassword({ email, password });
    // Compte créé sans session (confirmation d'e-mail activée) ou création refusée parce que le
    // compte existe déjà : on tente directement la connexion avec le même mot de passe.
    if (b.classList.contains('up') && (error ? /registered|rate limit|security purposes/i.test(error.message || '') : !data.session)) {
      const r = await sb.auth.signInWithPassword({ email, password });
      if (!r.error) { data = r.data; error = null; }
      else if (!error) error = r.error;
    }
    b.disabled = false;
    if (error) {
      const m = error.message || '';
      toast(/not confirmed/i.test(m) ? 'Compte créé ! Ouvre le lien de confirmation reçu par e-mail (regarde aussi dans les spams), puis reviens ici et touche « Se connecter ».'
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

// =====================================================================
// ===============  Bibliothèque de chants & sets  =====================
// =====================================================================
// Chant : { title, artist, key, bpm, sig, dur (s), style, struct[], links, notes }
// Set   : { name, date (AAAA-MM-JJ), notes }
// Élément de set : { setId, songId, title (copie), key|null, struct|null, lead, note, pos }
//   key / struct à null = on reprend ceux de la fiche du chant ; pos = ordre dans le set.
// Enregistrement : { parentId (chant ou élément de set), title, d (s), owner, at }
// + pour tous : team (équipe ou null = perso), _ts (horodatage par champ), _by (dernier auteur).
// Section de structure : { t: 'C', n: 1, x: 2, i: 'doux' }  →  « C1 ×2 doux »

// ---------- Préférences ----------
function pref(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
function setPref(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
var notation = pref('notation', 'fr');
let tab = pref('tab', 'sets');
if (!['sets', 'songs', 'notes'].includes(tab)) tab = 'sets';

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
    html(wrap, st.length ? pillsHTML(st) : '<span class="empty-st">' + (host.closest('.ro') ? 'Pas de structure.' : 'Touchez les sections ci-dessous dans l\'ordre, ou utilisez la saisie rapide.') + '</span>');
    if (document.activeElement !== quick) quick.value = stText(st);
  };
  pal.addEventListener('click', e => {
    const b = e.target.closest('[data-t]'); if (!b || host.closest('.ro')) return;
    const st = getSt().map(x => ({ ...x })), t = b.dataset.t;
    st.push({ t, n: t === 'C' ? 1 + Math.max(0, ...st.filter(x => x.t === 'C').map(x => x.n || 0)) : 0, x: 1, i: '' });
    setSt(st); draw();
  });
  wrap.addEventListener('click', e => { const p = e.target.closest('.pill'); if (p && !host.closest('.ro')) pillSheet(+p.dataset.i); });
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
// Remplace le contenu d'un élément seulement s'il a changé (pas de clignotement)
function html(el, s) { if (el.__h !== s) { el.innerHTML = s; el.__h = s; } }
// Écrit une valeur dans un champ seulement si elle a changé (le curseur ne saute pas pendant la saisie)
function setV(sel, v) {
  const e = typeof sel === 'string' ? $(sel) : sel;
  v = v == null ? '' : String(v);
  if (e.value === v) return;
  if (composing && document.activeElement === e) { pendingRefresh = true; return; }
  let st = null, en = null;
  try { st = e.selectionStart; en = e.selectionEnd; } catch (er) {}
  if (document.activeElement === e && typeof st === 'number' && window.diff_match_patch) {
    // Texte modifié par quelqu'un d'autre pendant que j'écris : le curseur suit le texte
    dmp = dmp || new diff_match_patch();
    const diffs = dmp.diff_main(e.value, v);
    e.value = v;
    try { e.setSelectionRange(dmp.diff_xIndex(diffs, st), dmp.diff_xIndex(diffs, en)); } catch (er) {}
  } else e.value = v;
}
const parseDur = v => { const m = String(v || '').trim().match(/^(\d{1,3})(?:\s*[:h'.,]\s*(\d{1,2}))?$/); return m ? (+m[1]) * 60 + (+(m[2] || 0)) : 0; };
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const dParse = iso => /^\d{4}-\d\d-\d\d$/.test(iso || '') ? new Date(iso + 'T12:00:00') : null;
const dShort = iso => { const d = dParse(iso); return d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : ''; };
function ago(t) {
  if (!t) return '';
  const s = (now() - t) / 1000;
  return s < 60 ? 'à l\'instant' : s < 3600 ? 'il y a ' + Math.round(s / 60) + ' min' : s < 86400 ? 'il y a ' + Math.round(s / 3600) + ' h' : 'le ' + new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
// « Modifié par Marie · il y a 5 min »
function modLine(o) {
  if (!o || !o._ts) return '';
  const t = Math.max(0, ...Object.entries(o._ts).filter(([k]) => k !== 'pos').map(([, v]) => +v || 0));
  if (t < 1e12) return '';
  const who = o.team && o._by ? (o._by === (user && user.id) ? 'toi' : memberName(o.team, o._by)) : '';
  return 'Modifié ' + (who ? 'par ' + who + ' · ' : '') + ago(t);
}

// ---------- Équipes ----------
let teams = [], members = [];
try { const c = JSON.parse(pref('teams', '[]')); teams = c.teams || []; members = c.members || []; } catch (e) {}
let space = pref('space', '');
const teamOf = id => teams.find(t => t.id === id);
const myRole = team => !team ? 'admin' : (teamOf(team) || {}).role || '';
const canEdit = team => myRole(team) === 'admin';
const inSpace = o => (o.team || '') === space;
const memberName = (team, id) => { const m = members.find(x => x.team_id === team && x.user_id === id); return (m && m.name) || 'un membre'; };
async function loadTeams(membership) {
  if (!sb || !user) return;
  const [{ data: ms, error: e1 }, { data: ts, error: e2 }] = await Promise.all([
    sb.from('team_members').select('team_id,user_id,role,name,joined_at'), sb.from('teams').select('id,name,code')]);
  if (e1 || e2) { console.warn('équipes', e1 || e2); return; }
  const had = teams.map(t => t.id).sort().join();
  members = ms; teams = ts.map(t => ({ ...t, role: (ms.find(m => m.team_id === t.id && m.user_id === user.id) || {}).role })).filter(t => t.role);
  setPref('teams', JSON.stringify({ teams, members }));
  if (space && !teamOf(space)) { space = ''; setPref('space', ''); }
  // Équipes quittées : on retire leurs documents de cet appareil
  for (const kind of ['song', 'set', 'item', 'rec']) for (const o of [...MEM[kind].values()]) if (o.team && !teamOf(o.team)) { MEM[kind].delete(o.id); del(KIND_STORE[kind], o.id); }
  if (membership && had !== teams.map(t => t.id).sort().join()) { live(); await sync(true); }
  refreshUI(true);
}
function spaceName(id) { return id ? (teamOf(id) || {}).name || 'Équipe' : 'Mon espace'; }
function spaceSheet() {
  const list = [{ id: '', name: 'Mon espace', sub: 'Perso, visible par toi seul' }, ...teams.map(t => ({ id: t.id, name: t.name, sub: t.role === 'admin' ? 'Équipe · responsable' : 'Équipe · musicien' }))];
  const sh = sheet('<p>Espace de travail</p><div class="pick"></div>'
    + (user ? '<button class="ok mk">+ Créer une équipe</button><button class="alt jn">Rejoindre une équipe avec un code</button>' + (space ? '<button class="alt mg">Gérer l\'équipe « ' + esc(spaceName(space)) + ' »</button>' : '')
      : '<small>Connecte-toi (bouton nuage) pour créer ou rejoindre une équipe.</small>')
    + '<button class="cancel">Fermer</button>');
  sh.querySelector('.pick').innerHTML = list.map(x => `<button data-space="${esc(x.id)}" class="${x.id === space ? 'on' : ''}"><b>${esc(x.name)}</b><em>${esc(x.sub)}</em></button>`).join('');
  sh.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.space != null) { space = b.dataset.space; setPref('space', space); sh.remove(); nav = []; render(); }
    else if (b.classList.contains('mk')) { sh.remove(); teamForm('create'); }
    else if (b.classList.contains('jn')) { sh.remove(); teamForm('join'); }
    else if (b.classList.contains('mg')) { sh.remove(); manageTeam(space); }
  });
}
function teamForm(mode, code) {
  const sh = sheet(mode === 'create'
    ? '<p>Créer une équipe</p><input class="fld tn" placeholder="Nom de l\'équipe (ex. Louange Église X)" autocomplete="off"><input class="fld yn" placeholder="Ton prénom (visible par l\'équipe)" autocomplete="given-name"><small>Tu seras responsable de l\'équipe. Tu pourras ensuite inviter les membres avec un code.</small><button class="ok go">Créer</button><button class="cancel">Annuler</button>'
    : '<p>Rejoindre une équipe</p><input class="fld tc" placeholder="Code d\'invitation (6 caractères)" autocomplete="off" autocapitalize="characters"><input class="fld yn" placeholder="Ton prénom (visible par l\'équipe)" autocomplete="given-name"><button class="ok go">Rejoindre</button><button class="cancel">Annuler</button>');
  const yn = sh.querySelector('.yn'); yn.value = pref('myname', '');
  if (code) sh.querySelector('.tc').value = code;
  sh.querySelector('.go').onclick = async () => {
    const name = clean(yn.value); if (!name) { toast('Indique ton prénom'); return; }
    setPref('myname', name);
    const { data, error } = mode === 'create'
      ? await sb.rpc('create_team', { p_name: clean(sh.querySelector('.tn').value), p_member_name: name })
      : await sb.rpc('join_team', { p_code: clean(sh.querySelector('.tc').value), p_member_name: name });
    if (error) { toast(/code_invalide/.test(error.message) ? 'Code inconnu : vérifie-le auprès du responsable.' : 'Erreur : ' + error.message); return; }
    sh.remove();
    await loadTeams(true);
    space = data.id; setPref('space', space); nav = []; render();
    toast(mode === 'create' ? 'Équipe « ' + data.name + ' » créée. Invite les membres depuis « Gérer l\'équipe ».' : 'Bienvenue dans « ' + data.name + ' » !');
    if (mode === 'create' && [...songs.values(), ...sets.values()].some(o => !o.team)) manageTeam(data.id, true);
  };
}
function inviteLink(t) { return location.origin + location.pathname + '#join=' + t.code; }
function manageTeam(id, offerTransfer) {
  const t = teamOf(id); if (!t) return;
  const admin = t.role === 'admin';
  const ms = members.filter(m => m.team_id === id).sort((a, b) => (a.role === b.role ? (a.name || '').localeCompare(b.name || '') : a.role === 'admin' ? -1 : 1));
  const sh = sheet(`<p></p>
    ${admin ? '<small>Nom de l\'équipe</small><input class="fld tn" autocomplete="off">' : ''}
    <small>Invitation : donne ce code ou partage le lien</small><div class="code"></div>
    <div class="row2"><button class="alt share">Partager l'invitation</button>${admin ? '<button class="alt renew">Nouveau code</button>' : ''}</div>
    <small>Membres (${ms.length})</small><div class="members"></div>
    <small>Mon prénom dans l'équipe</small><input class="fld yn" autocomplete="given-name">
    ${admin ? '<button class="alt tr">Transférer mes chants et sets perso dans l\'équipe</button>' : ''}
    <button class="danger leave">Quitter l'équipe</button><button class="cancel">Fermer</button>`);
  sh.querySelector('p').textContent = t.name;
  sh.querySelector('.code').textContent = t.code;
  if (admin) sh.querySelector('.tn').value = t.name;
  sh.querySelector('.yn').value = (ms.find(m => m.user_id === user.id) || {}).name || '';
  sh.querySelector('.members').innerHTML = ms.map(m => `<div class="mem"><span><b>${esc(m.name || 'Sans nom')}${m.user_id === user.id ? ' (toi)' : ''}</b><em>${m.role === 'admin' ? 'Responsable' : 'Musicien'}</em></span>${admin && m.user_id !== user.id ? `<button class="alt role" data-u="${m.user_id}" data-r="${m.role === 'admin' ? 'member' : 'admin'}">${m.role === 'admin' ? 'Passer musicien' : 'Passer responsable'}</button><button class="alt kick" data-u="${m.user_id}">Retirer</button>` : ''}</div>`).join('');
  if (admin) sh.querySelector('.tn').addEventListener('change', async e => {
    const { error } = await sb.from('teams').update({ name: clean(e.target.value) || t.name }).eq('id', id);
    if (error) toast('Erreur : ' + error.message); else { await loadTeams(); sh.querySelector('p').textContent = clean(e.target.value); }
  });
  sh.querySelector('.yn').addEventListener('change', async e => {
    const name = clean(e.target.value); if (!name) return;
    setPref('myname', name);
    const { error } = await sb.rpc('set_my_name', { p_team: id, p_name: name });
    if (error) toast('Erreur : ' + error.message); else loadTeams();
  });
  sh.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('share')) {
      const text = `Rejoins l'équipe « ${t.name} » sur l'app Sets : ouvre ce lien (ou entre le code ${t.code} dans « Rejoindre une équipe »).`;
      if (navigator.share) navigator.share({ title: 'Invitation', text, url: inviteLink(t) }).catch(() => {});
      else { try { await navigator.clipboard.writeText(text + ' ' + inviteLink(t)); toast('Invitation copiée'); } catch (er) { toast(inviteLink(t)); } }
    } else if (b.classList.contains('renew')) {
      const { data, error } = await sb.rpc('renew_team_code', { p_team: id });
      if (error) toast('Erreur : ' + error.message); else { sh.querySelector('.code').textContent = data; await loadTeams(); toast('Nouveau code : l\'ancien ne marche plus.'); }
    } else if (b.classList.contains('role')) {
      const { error } = await sb.rpc('set_member_role', { p_team: id, p_user: b.dataset.u, p_role: b.dataset.r });
      if (error) toast(/dernier_responsable/.test(error.message) ? 'Il faut au moins un responsable.' : 'Erreur : ' + error.message);
      else { sh.remove(); await loadTeams(); manageTeam(id); }
    } else if (b.classList.contains('kick')) {
      ask('Retirer ce membre de l\'équipe ?', async () => {
        const { error } = await sb.from('team_members').delete().eq('team_id', id).eq('user_id', b.dataset.u);
        if (error) toast('Erreur : ' + error.message); else { sh.remove(); await loadTeams(); manageTeam(id); }
      });
    } else if (b.classList.contains('tr')) {
      sh.remove(); transferToTeam(id);
    } else if (b.classList.contains('leave')) {
      const admins = ms.filter(m => m.role === 'admin').length;
      if (admin && admins <= 1 && ms.length > 1) { toast('Nomme d\'abord un autre responsable avant de quitter l\'équipe.'); return; }
      ask('Quitter l\'équipe « ' + t.name + ' » ? Ses chants et sets disparaîtront de tes appareils.', async () => {
        const { error } = await sb.from('team_members').delete().eq('team_id', id).eq('user_id', user.id);
        if (error) { toast('Erreur : ' + error.message); return; }
        sh.remove(); space = ''; setPref('space', ''); await loadTeams(); nav = []; render();
      });
    }
  });
  if (offerTransfer) setTimeout(() => ask('Transférer tes chants et sets perso dans l\'équipe « ' + t.name + ' » ? Toute l\'équipe pourra les voir.', () => transferToTeam(id)), 300);
}
// La fenêtre de confirmation « ask » dit « Supprimer » : on en fait une variante neutre ici
function transferToTeam(id) {
  let n = 0;
  for (const kind of ['song', 'set', 'item', 'rec']) for (const o of MEM[kind].values()) if (!o.team) { o.team = id; edit(kind, o, {}); n++; }
  space = id; setPref('space', space); nav = []; render();
  toast(n ? 'Chants et sets transférés dans l\'équipe.' : 'Rien à transférer.');
}
// Lien d'invitation : https://…/Notes/#join=CODE
function readJoinLink() {
  const code = (location.hash.match(/join=([A-Za-z0-9]{4,12})/) || [])[1];
  if (code) { setPref('pendingJoin', code.toUpperCase()); history.replaceState(null, '', location.pathname + location.search); }
  return !!code;
}
readJoinLink();
addEventListener('hashchange', () => { if (readJoinLink()) checkPendingJoin(); });
function checkPendingJoin() {
  const code = pref('pendingJoin', ''); if (!code) return;
  if (!user) { if (!document.querySelector('.sheet')) cloudSheet(); toast('Pour rejoindre l\'équipe, crée ton compte (ou connecte-toi). L\'invitation s\'ouvrira ensuite.'); return; }
  setPref('pendingJoin', '');
  if (!teams.some(t => t.code === code)) teamForm('join', code);
}

// ---------- Données dérivées ----------
const itemsOf = setId => [...items.values()].filter(i => i.setId === setId).sort((a, b) => (a.pos - b.pos) || a.id.localeCompare(b.id));
// Chant auquel appartient un enregistrement (fiche du chant, ou chant d'un set)
const recSong = r => !r ? null : songs.has(r.parentId) ? r.parentId : (items.get(r.parentId) || {}).songId || null;
// L'enregistrement officiel d'un chant (un seul) : la version de référence de l'équipe
const officialOf = songId => songId ? [...recDocs.values()].filter(r => r.official && !r.part && recSong(r) === songId).sort((a, b) => (b._ts && b._ts.official || 0) - (a._ts && a._ts.official || 0))[0] || null : null;
function setOfficial(r, on) {
  if (on) for (const o of [...recDocs.values()]) if (o !== r && o.official && recSong(o) === recSong(r)) edit('rec', o, { official: false });
  edit('rec', r, { official: !!on });
  refreshUI(true);
}
const recsOf = parentId => [...recDocs.values()].filter(r => r.parentId === parentId).sort((a, b) => (a.at || 0) - (b.at || 0));
const itemTitle = it => clean((songs.get(it.songId) || {}).title || it.title || '') || 'Chant supprimé';
const itemKey = it => it.key || (songs.get(it.songId) || {}).key || '';
const itemSt = it => it.struct || (songs.get(it.songId) || {}).struct || [];
const pnoteOf = parentId => user ? pnotes.get('pn-' + user.id + '-' + parentId) : null;
function setSummary(set) {
  const its = itemsOf(set.id); let tot = 0, miss = 0;
  for (const it of its) { const d = (songs.get(it.songId) || {}).dur || 0; if (d) tot += d; else miss++; }
  return its.length + (its.length > 1 ? ' chants' : ' chant') + (tot ? ' · ~' + Math.max(1, Math.round(tot / 60)) + ' min' + (miss ? ' (+' + miss + ' sans durée)' : '') : '');
}
const STYLES = ['Louange', 'Adoration', 'Gospel', 'Pop', 'Rock', 'Ballade', 'Shuffle', 'Reggae', 'Afro', 'Zouk', 'Kompa', 'Latino', 'Hymne', 'Acoustique', 'Soul', 'Funk', 'Rapide', 'Lent'];
function refreshStyles() {
  const s = new Set([...STYLES, ...[...songs.values()].map(x => clean(x.style || '')).filter(Boolean)]);
  html($('#styles'), [...s].map(v => `<option value="${esc(v)}">`).join(''));
}
async function loadDocs() {
  for (const kind of ['song', 'set', 'item', 'rec', 'pnote']) {
    MEM[kind].clear();
    for (const o of await all(KIND_STORE[kind])) if (!o.deleted) MEM[kind].set(o.id, o);
  }
  refreshStyles();
}
// Conversion des données de l'ancienne version (une seule fois)
async function migrateLocal() {
  if (pref('schema', '') === '3') return;
  const tsOf = o => o.synced != null && o.synced === o.updated ? 1 : (o.updated || Date.now());
  const mk = (id, f, t, team = null) => ({ id, ...f, team, _ts: Object.fromEntries(Object.keys(f).map(k => [k, t])), ver: 0, dirty: t !== 1, seq: 0 });
  for (const n of await all('notes')) {
    if (n._ts) continue;
    if (n.deleted) { if (n.synced) await put('notes', { id: n.id, deleted: true, dirty: true, ver: 0, _ts: {} }); else await del('notes', n.id); continue; }
    await put('notes', mk(n.id, { title: n.title || '', html: n.html || '', text: n.text || '', recs: n.recs || 0, edited: n.updated || Date.now() }, tsOf(n)));
  }
  for (const s of await all('songs')) {
    if (s._ts) continue;
    const t = tsOf(s);
    if (s.deleted) { if (s.synced) await put('songs', { id: s.id, deleted: true, dirty: true, ver: 0, _ts: {} }); else await del('songs', s.id); continue; }
    for (const r of s.recs || []) await put('recs', mk(r.id, { parentId: s.id, title: r.title || '', d: r.d || 0, owner: null, at: t }, t));
    await put('songs', mk(s.id, { title: s.title || '', artist: s.artist || '', key: s.key || '', bpm: s.bpm || '', sig: s.sig || '', dur: s.dur || 0, style: s.style || '', struct: s.struct || [], links: s.links || '', notes: s.notes || '' }, t));
  }
  for (const s of await all('sets')) {
    if (s._ts) continue;
    const t = tsOf(s);
    if (s.deleted) { if (s.synced) await put('sets', { id: s.id, deleted: true, dirty: true, ver: 0, _ts: {} }); else await del('sets', s.id); continue; }
    (s.items || []).forEach((it, i) => {
      put('items', mk(it.id, { setId: s.id, songId: it.songId, title: it.title || '', key: it.key || null, struct: it.struct || null, lead: it.lead || '', note: it.note || '', pos: i }, t));
      for (const r of it.recs || []) put('recs', mk(r.id, { parentId: it.id, title: r.title || '', d: r.d || 0, owner: null, at: t }, t));
    });
    await put('sets', mk(s.id, { name: s.name || '', date: s.date || '', notes: s.notes || '' }, t));
  }
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('pull:')) localStorage.removeItem(k); } catch (e) {}
  setPref('schema', '3');
}

// ---------- Rafraîchissement de l'écran après une modification reçue ----------
function refreshUI(force) {
  const kinds = new Set(changedKinds); changedKinds.clear();
  if (!force && !kinds.size) return;
  if ([...kinds].some(k => k === 'song')) refreshStyles();
  const t = topNav();
  if (!t) {
    if ($('#list').classList.contains('hidden')) return;
    if (force || (tab === 'notes' ? kinds.has('note') : [...kinds].some(k => k !== 'note' && k !== 'pnote'))) renderTab();
    return;
  }
  if (t.v === 'editor') return;
  render();
}

// ---------- Navigation entre écrans ----------
const VIEWS = ['list', 'editor', 'song', 'set', 'item', 'stage'];
function showView(v) { VIEWS.forEach(x => $('#' + x).classList.toggle('hidden', x !== v)); }
const topNav = () => nav[nav.length - 1];
const scrollerOf = v => $('#' + v + ' .scroller') || $('#' + v + ' .stmain');
async function go(v, params) {
  await flush();
  const t = topNav(); if (t) t.scroll = scrollerOf(t.v).scrollTop;
  nav.push({ v, ...params }); render(true);
}
async function goBack() {
  if (rec) await stopRec();
  await flush();
  const t = nav.pop();
  if (t && t.v === 'stage') closeStage();
  if (t && t.v === 'song') { const s = songs.get(t.id); if (s && !s.ver && !clean(s.title || '') && !s.artist && !s.key && !(s.struct || []).length && !recsOf(s.id).length && !s.notes && !s.links && ![...items.values()].some(i => i.songId === s.id)) remove('song', s); }
  if (t && t.v === 'set') { const s = sets.get(t.id); if (s && !s.ver && !clean(s.name || '') && !itemsOf(s.id).length && !s.notes) remove('set', s); }
  render();
}
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', goBack));
function render(fresh) {
  const t = topNav();
  if (!t) { showView('list'); renderTab(); return; }
  const doc = t.v === 'song' ? songs.get(t.id) : sets.get(t.id);
  if (!doc) { nav.pop(); toast('Cet élément a été supprimé.'); return render(); }
  showView(t.v);
  const prev = nav[nav.length - 2];
  if (t.v !== 'stage') $('#' + t.v + ' [data-back] span').textContent = !prev ? { sets: 'Sets', songs: 'Chants', notes: 'Notes' }[tab] : { set: 'Set', song: 'Chant', item: 'Retour' }[prev.v];
  const ed = canEdit(doc.team);
  $('#' + t.v).classList.toggle('ro', !ed);
  $('#' + t.v).querySelectorAll('.form input, .form textarea, .form select, .form .fld').forEach(e => { if (!e.closest('.mine')) e.disabled = !ed; });
  ({ song: renderSong, set: renderSet, item: renderItem, stage: renderStage })[t.v](t);
  if (fresh) scrollerOf(t.v).scrollTop = 0;
}

// ---------- Accueil : onglets ----------
function renderTab() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#h1').textContent = { sets: 'Sets', songs: 'Chants', notes: 'Notes' }[tab];
  $('#space').classList.toggle('hidden', tab === 'notes' || (!user && !teams.length));
  $('#space span').textContent = spaceName(space);
  $('#q').placeholder = { sets: 'Rechercher un set ou un chant', songs: 'Rechercher un chant, un auteur, un style', notes: 'Rechercher' }[tab];
  $('#new').setAttribute('aria-label', { sets: 'Nouveau set', songs: 'Nouveau chant', notes: 'Nouvelle note' }[tab]);
  $('#new').classList.toggle('hidden', tab !== 'notes' && !canEdit(space || null));
  $('#grid').classList.toggle('rows', tab !== 'notes');
  return tab === 'notes' ? renderNotes() : tab === 'songs' ? renderSongs() : renderSets();
}
$('.tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  tab = b.dataset.tab; setPref('tab', tab); $('#q').value = ''; renderTab(); $('#grid').scrollTop = 0;
});
$('#space').onclick = spaceSheet;
$('#new').onclick = () => {
  if (tab === 'notes') return newNote();
  const team = space || null;
  if (tab === 'songs') { const s = create('song', { title: '', artist: '', key: '', bpm: '', sig: '', dur: 0, style: '', struct: [], links: '', notes: '' }, team); return go('song', { id: s.id, focus: true }); }
  const s = create('set', { name: '', date: todayISO(), notes: '' }, team);
  go('set', { id: s.id, focus: true });
};
$('#grid').addEventListener('click', e => {
  const so = e.target.closest('[data-song]'); if (so) return go('song', { id: so.dataset.song });
  const se = e.target.closest('[data-set]'); if (se) return go('set', { id: se.dataset.set });
});
const cmpTitle = (a, b) => clean(a.title || '').localeCompare(clean(b.title || ''), 'fr', { sensitivity: 'base' });
function renderSongs() {
  const q = $('#q').value.trim().toLowerCase();
  const mine = [...songs.values()].filter(inSpace);
  const list = mine.sort(cmpTitle).filter(s => !q || [s.title, s.artist, s.style].join(' ').toLowerCase().includes(q));
  $('#count').textContent = mine.length + (mine.length > 1 ? ' chants' : ' chant');
  html($('#grid'), list.length ? list.map(s => `<button class="songc" data-song="${esc(s.id)}"><span class="l1"><b>${esc(clean(s.title || '') || 'Sans titre')}</b>${s.key ? `<span class="key">${esc(keyLabel(s.key))}</span>` : ''}</span><span class="meta">${esc([s.artist, s.bpm && s.bpm + ' BPM', s.sig, s.style].filter(Boolean).join(' · ') || '—')}</span>${pillsHTML(s.struct, true)}</button>`).join('')
    : `<div class="empty">${q ? 'Aucun résultat' : canEdit(space || null) ? 'Aucun chant.<br>Touchez + pour créer la première fiche.' : 'Aucun chant dans l\'équipe pour l\'instant.'}</div>`);
}
function renderSets() {
  const q = $('#q').value.trim().toLowerCase(), today = todayISO();
  const mine = [...sets.values()].filter(inSpace);
  const list = mine.filter(s => !q || [s.name, ...itemsOf(s.id).map(itemTitle)].join(' ').toLowerCase().includes(q));
  const up = list.filter(s => (s.date || '9999') >= today).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const past = list.filter(s => (s.date || '9999') < today).sort((a, b) => b.date.localeCompare(a.date));
  $('#count').textContent = mine.length + (mine.length > 1 ? ' sets' : ' set');
  const card = (s, p) => {
    const d = dParse(s.date);
    return `<button class="setc${p ? ' past' : ''}" data-set="${esc(s.id)}"><span class="dt">${d ? `<small>${d.toLocaleDateString('fr-FR', { weekday: 'short' })}</small><b>${d.getDate()}</b><small>${d.toLocaleDateString('fr-FR', { month: 'short' })}</small>` : '<b>—</b>'}</span><span class="bd"><b>${esc(clean(s.name || '') || 'Set sans nom')}</b><span>${esc(setSummary(s))}</span><span>${esc(itemsOf(s.id).map(itemTitle).join(' · ') || 'Aucun chant')}</span></span></button>`;
  };
  html($('#grid'), (up.length ? '<h4>À venir</h4>' + up.map(s => card(s)).join('') : '') + (past.length ? '<h4>Passés</h4>' + past.map(s => card(s, true)).join('') : '')
    || `<div class="empty">${q ? 'Aucun résultat' : canEdit(space || null) ? 'Aucun set.<br>Touchez + pour préparer le premier.' : 'Aucun set dans l\'équipe pour l\'instant.'}</div>`);
}

// ---------- Enregistrements d'une fiche (chant ou chant d'un set) ----------
// Chaque enregistrement est un document à part : chacun peut ajouter les siens.
function renderRecs(host, parentId, suggest, extra = [], opts = {}) {
  // extra : enregistrements montrés en plus (ex. l'officiel d'un chant, fait pendant une répétition)
  // opts.st : structure (pour ranger les parties) ; opts.pick : chant du set (choix 🎧 de l'enregistrement écouté)
  const all = [...extra.filter(r => r && r.parentId !== parentId), ...recsOf(parentId)];
  const order = partsOf(opts.st);
  const rank = r => { if (!r.part) return -1; const f = partList(r.part)[0]; return (order.includes(f) ? order.indexOf(f) : 999) + partList(r.part).length / 100; };
  const list = all.map((r, i) => [r, i]).sort((a, b) => (rank(a[0]) - rank(b[0])) || (a[1] - b[1])).map(x => x[0]);
  const picked = opts.pick ? listenRecOf(opts.pick) : null;
  const ro = r => !(user && (r.owner === user.id || (!r.owner && !r.team))) && !canEdit(r.team) && r.team;
  const sig = list.map(r => [r.id, r.title, r.d, ro(r) ? 1 : 0, r.official ? 1 : 0, canEdit(r.team) ? 1 : 0, r.part || '', picked === r ? 1 : 0].join('|')).join('/') + '#' + order.join();
  host.recSuggest = suggest;
  if (host.__sig === sig) return;
  host.__sig = sig;
  const keep = {}; host.querySelectorAll('.rec').forEach(c => { keep[c.dataset.id] = c; });
  host.innerHTML = '';
  const hasParts = list.some(r => r.part);
  let group = null;
  for (const r of list) {
    // Titres de groupe : « Chant complet », puis « Par partie »
    const g = r.part ? 'parts' : 'full';
    if (hasParts && g !== group) { group = g; const h = document.createElement('div'); h.className = 'rgh'; h.textContent = g === 'full' ? 'Chant complet' : 'Par partie'; host.append(h); }
    let c = keep[r.id];
    if (!c) { c = chip(r.id, r.d || 0, r.title); loadAudio(r.id); }
    else setTitle(c, r.title);
    c.classList.toggle('ro', !!ro(r));
    const by = r.team && r.owner && r.owner !== (user && user.id) ? memberName(r.team, r.owner) : '';
    c.title = by ? 'Enregistré par ' + by : '';
    // Partie (pastille) : touchée → changer la partie
    let pb = c.querySelector('.pbadge');
    if (!pb) { pb = document.createElement('button'); pb.type = 'button'; pb.className = 'pbadge'; c.querySelector('.nm').before(pb); }
    pb.innerHTML = r.part ? partList(r.part).map(x => `<i style="--c:${partColor(x)}">${esc(x)}</i>`).join('') : 'Complet';
    pb.classList.toggle('full', !r.part);
    // 🎧 : enregistrement complet écouté pour ce set
    let pk = c.querySelector('.pick');
    if (opts.pick && !r.part) {
      if (!pk) { pk = document.createElement('button'); pk.type = 'button'; pk.className = 'pick'; pk.textContent = '🎧'; c.querySelector('.sh').before(pk); }
      pk.classList.toggle('on', picked === r);
      pk.classList.toggle('hidden', picked !== r && !canEdit(opts.pick.team));
      pk.setAttribute('aria-label', picked === r ? 'Écouté dans ce set' : 'Écouter celui-ci dans ce set');
    } else if (pk) pk.remove();
    // Étoile : enregistrement officiel du chant (modifiable par les responsables, chant complet seulement)
    let st = c.querySelector('.star');
    if (!st) { st = document.createElement('button'); st.type = 'button'; st.className = 'star'; c.querySelector('.sh').before(st); }
    st.textContent = r.official ? '★' : '☆';
    st.classList.toggle('on', !!r.official);
    st.classList.toggle('hidden', !!r.part || (!r.official && !canEdit(r.team)));
    st.setAttribute('aria-label', r.official ? 'Enregistrement officiel' : 'Marquer comme officiel');
    c.classList.toggle('off', !!r.official);
    const from = r.parentId !== parentId && items.get(r.parentId);
    let fr = c.querySelector('.from');
    if (from) { const set = sets.get(from.setId); if (!fr) { fr = document.createElement('span'); fr.className = 'from'; c.querySelector('.mid').append(fr); } fr.textContent = 'Enregistré en répétition' + (set ? ' · ' + (clean(set.name || '') || 'set') + (set.date ? ' du ' + dShort(set.date) : '') : ''); }
    else if (fr) fr.remove();
    host.append(c);
  }
}
async function loadAudio(id) {
  if (urls[id]) return;
  const a = await getAudio(id);
  if (a) { urls[id] = URL.createObjectURL(a.blob); memBlob(id, a.blob); }
}
// Renommer / supprimer depuis un lecteur d'une fiche
function recOp(c, op, title) {
  const r = recDocs.get(c.dataset.id); if (!r) return;
  if (op === 'rename') edit('rec', r, { title: clean(title) });
  else remove('rec', r);
  refreshUI(true);
}
function newRec(parentId, team, title, part) {
  return (id, d, t) => {
    const r = { id, parentId, title: t, d, owner: user ? user.id : null, at: now() };
    if (part) r.part = part; // partie de la structure (I, C1, R…) ; absente = chant complet
    const o = { ...r, team: team || null, _ts: {}, ver: 0, dirty: true, seq: 1 };
    const ts = now(); for (const k in r) if (k !== 'id') o._ts[k] = ts;
    if (o.team && user) { o._by = user.id; o._ts._by = ts; }
    recDocs.set(id, o); storeLocal('rec', o);
    refreshUI(true);
  };
}
// ---------- Enregistrements par partie ----------
// Parties proposées : les sections de la structure (I, C1, R, C2, P…), sans doublon, dans l'ordre.
const partsOf = st => [...new Set((st || []).map(secLabel))];
const partColor = p => secColor(String(p || '').replace(/\d+$/, ''));
const partName = p => { const t = String(p || '').replace(/\d+$/, ''), n = String(p || '').match(/\d+$/); return SEC[t] ? SEC[t][0] + (n ? ' ' + n[0] : '') : p; };
// Une ou plusieurs parties : enregistrées sous la forme « I+C1+C2 », affichées « I + C1 + C2 »
const partList = p => String(p || '').split('+').filter(Boolean);
const partLabel = p => partList(p).join(' + ');
// Fenêtre « Que vas-tu enregistrer ? » : chant complet, ou une ou plusieurs parties (dans l'ordre de la structure)
function partSheet(st, title, onPick, current) {
  const parts = partsOf(st);
  const sel = new Set(current && current !== 'full' ? partList(current) : []);
  for (const p of sel) if (!parts.includes(p)) parts.push(p);
  const sh = sheet('<p></p><button class="ok full">Chant complet</button><small>' + (parts.length ? 'Ou choisis une ou plusieurs parties, puis valide :' : 'Ajoute une structure au chant pour enregistrer par partie.') + '</small><div class="partgrid"></div><button class="ok okp">Valider</button><button class="cancel">Annuler</button>');
  sh.querySelector('p').textContent = title;
  sh.querySelector('.full').classList.toggle('cur', current === 'full');
  sh.querySelector('.partgrid').innerHTML = parts.map(p => `<button data-part="${esc(p)}" style="--c:${partColor(p)}"><b>${esc(p)}</b><em>${esc(partName(p))}</em></button>`).join('');
  const upd = () => {
    sh.querySelectorAll('[data-part]').forEach(x => x.classList.toggle('cur', sel.has(x.dataset.part)));
    const chosen = parts.filter(p => sel.has(p));
    const ok = sh.querySelector('.okp');
    ok.classList.toggle('hidden', !parts.length);
    ok.disabled = !chosen.length;
    ok.textContent = chosen.length ? 'Valider : ' + chosen.join(' + ') : 'Choisis au moins une partie';
  };
  upd();
  sh.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('full')) { sh.remove(); onPick(''); }
    else if (b.dataset.part) { sel.has(b.dataset.part) ? sel.delete(b.dataset.part) : sel.add(b.dataset.part); upd(); }
    else if (b.classList.contains('okp') && sel.size) { sh.remove(); onPick(parts.filter(p => sel.has(p)).join('+')); }
  });
}
const withPart = (title, part) => part ? title.replace(/^([^–]+)( – |$)/, (m, a, sep) => a.trim() + ' – ' + partLabel(part) + (sep ? ' – ' : '')) : title;
// Le bon enregistrement « complet » de répétition pour un chant d'un set : celui choisi (🎧),
// sinon le dernier enregistré.
const fullRecs = parentId => recsOf(parentId).filter(r => !r.part);
const listenRecOf = it => { const list = fullRecs(it.id); return list.find(r => r.id === it.listenRec) || list.filter(r => !r.official).slice(-1)[0] || list.slice(-1)[0] || null; };

// Notes perso (visibles par moi seul) sur un chant ou un chant d'un set d'équipe
function bindPnote(sel, parentOf) {
  $(sel).addEventListener('input', () => {
    const p = parentOf(); if (!p || !user) return;
    const id = 'pn-' + user.id + '-' + p.id;
    let o = pnotes.get(id);
    if (!o) { o = { id, parentId: p.id, text: '', team: null, _ts: {}, ver: 0, seq: 0 }; pnotes.set(id, o); }
    edit('pnote', o, { text: $(sel).value });
  });
}
function drawPnote(wrap, sel, parent) {
  const show = !!(user && parent && parent.team);
  $(wrap).classList.toggle('hidden', !show);
  if (show) setV(sel, (pnoteOf(parent.id) || {}).text || '');
}

// ---------- Fiche d'un chant ----------
const curSong = () => { const t = topNav(); return t && t.v === 'song' ? songs.get(t.id) : null; };
const songSuggest = s => () => [clean(s.title || ''), clean(s.title || '') + (s.key ? ' – ' + keyLabel(s.key) : ''), clean(s.title || '') + ' – répétition', clean(s.title || '') + ' – voix guide'];
function renderSong(t) {
  const s = songs.get(t.id);
  setV('#s-title', s.title || ''); setV('#s-artist', s.artist || '');
  $('#s-key').textContent = s.key ? keyLabel(s.key) : '—';
  setV('#s-bpm', s.bpm || ''); setV('#s-sig', s.sig || ''); setV('#s-dur', s.dur ? fmt(s.dur) : '');
  setV('#s-style', s.style || ''); setV('#s-links', s.links || ''); setV('#s-notes', s.notes || '');
  $('#s-mod').textContent = modLine(s);
  drawLinks(s); songSt.draw(); drawMetroBtns();
  renderRecs($('#s-recs'), s.id, songSuggest(s), [officialOf(s.id)], { st: s.struct });
  drawVideos(s);
  drawPnote('#s-mine', '#s-pnote', s);
  const used = [...sets.values()].filter(x => itemsOf(x.id).some(i => i.songId === s.id)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  html($('#s-used'), used.length ? used.map(x => `<button data-goset="${esc(x.id)}">${esc((dShort(x.date) ? dShort(x.date) + ' · ' : '') + (clean(x.name || '') || 'Set sans nom'))} ›</button>`).join('') : '<span>Dans aucun set pour l\'instant.</span>');
  if (t.focus) { t.focus = false; setTimeout(() => $('#s-title').focus(), 60); }
}
function drawLinks(s) {
  html($('#s-linkview'), (s.links || '').split(/\s+/).filter(u => /^https?:\/\/\S+$/i.test(u))
    .map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/i, ''))}</a>`).join(''));
}
function bindSong(sel, f, ev = 'input') {
  $(sel).addEventListener(ev, () => { const s = curSong(); if (!s) return; edit('song', s, f(s, $(sel).value)); });
}
bindSong('#s-title', (s, v) => ({ title: v }));
bindSong('#s-artist', (s, v) => ({ artist: v }));
bindSong('#s-bpm', (s, v) => ({ bpm: v.replace(/\D/g, '').slice(0, 3) }));
bindSong('#s-sig', (s, v) => ({ sig: v }), 'change');
bindSong('#s-dur', (s, v) => { const d = parseDur(v); $('#s-dur').value = d ? fmt(d) : ''; return { dur: d }; }, 'change');
bindSong('#s-style', (s, v) => ({ style: v }));
$('#s-style').addEventListener('change', refreshStyles);
bindSong('#s-links', (s, v) => { setTimeout(() => drawLinks(s)); return { links: v }; });
bindSong('#s-notes', (s, v) => ({ notes: v }));
bindPnote('#s-pnote', curSong);
$('#s-key').onclick = () => {
  const s = curSong(); if (!s || !canEdit(s.team)) return;
  keySheet(s.key, k => { edit('song', s, { key: k || '' }); $('#s-key').textContent = k ? keyLabel(k) : '—'; });
};
const songSt = structEditor($('#s-struct'), () => (curSong() || {}).struct || [], st => { const s = curSong(); if (s) edit('song', s, { struct: st }); });
$('#s-rec').onclick = () => {
  if (rec) return stopRec();
  const s = curSong(); if (!s) return;
  const base = clean(s.title || '') ? clean(s.title) + (s.key ? ' – ' + keyLabel(s.key) : '') : 'Enregistrement';
  partSheet(s.struct, 'Que vas-tu enregistrer ?', part => recToggle(withPart(base, part), newRec(s.id, s.team, '', part)));
};
$('#s-used').addEventListener('click', e => { const b = e.target.closest('[data-goset]'); if (b) go('set', { id: b.dataset.goset }); });
$('#s-del').onclick = () => {
  const s = curSong(); if (!s) return;
  const n = [...sets.values()].filter(x => itemsOf(x.id).some(i => i.songId === s.id)).length;
  ask('Supprimer ce chant de la bibliothèque ?' + (n ? ` Il est utilisé dans ${n} set${n > 1 ? 's' : ''} (son titre y restera).` : ''), async () => {
    if (rec) await stopRec();
    for (const r of recsOf(s.id)) remove('rec', r);
    remove('song', s); nav.pop(); render();
  });
};

// ---------- Un set ----------
const curSet = () => { const t = topNav(); return t && (t.v === 'set' || t.v === 'item') ? sets.get(t.id) : null; };
function renderSet(t) {
  const s = sets.get(t.id);
  setV('#set-name', s.name || ''); setV('#set-date', s.date || ''); setV('#set-notes', s.notes || '');
  $('#set-mod').textContent = modLine(s);
  drawItems(s);
  if (t.focus) { t.focus = false; setTimeout(() => $('#set-name').focus(), 60); }
}
const ARROW = d => `<svg viewBox="0 0 24 24"><path d="${d ? 'm6 9 6 6 6-6' : 'm6 15 6-6 6 6'}"/></svg>`;
function drawItems(s) {
  $('#set-sum').textContent = setSummary(s);
  const ed = canEdit(s.team);
  html($('#set-items'), itemsOf(s.id).map((it, i) => {
    const song = songs.get(it.songId), k = itemKey(it), changed = it.key && song && song.key && it.key !== song.key;
    const n = recsOf(it.id).length;
    const meta = [song && song.bpm && song.bpm + ' BPM', song && song.style, it.lead && 'Lead : ' + it.lead, n && '🎙 ' + n].filter(Boolean).join(' · ');
    return `<div class="itc" data-it="${esc(it.id)}"><span class="num">${i + 1}</span><button class="main" type="button"><span class="l1"><b>${esc(itemTitle(it))}</b>${k ? `<span class="key">${esc(keyLabel(k))}${changed ? `<s>orig. ${esc(keyLabel(song.key))}</s>` : ''}</span>` : ''}</span>${meta ? `<span class="meta">${esc(meta)}</span>` : ''}${pillsHTML(itemSt(it), true)}${it.note ? `<span class="note">↳ ${esc(it.note)}</span>` : ''}</button>${ed ? `<span class="mv"><button type="button" data-mv="-1" aria-label="Monter">${ARROW(0)}</button><button type="button" data-mv="1" aria-label="Descendre">${ARROW(1)}</button></span>` : ''}</div>`;
  }).join('') || '<p class="empty-st">Aucun chant pour l\'instant.</p>');
}
// Déplacer un chant : on change seulement SA position (entre ses nouveaux voisins), ce qui
// n'entre pas en conflit avec les modifications faites par d'autres sur le même set.
function moveItem(s, id, dir) {
  let list = itemsOf(s.id);
  if (list.some((x, i) => i && x.pos === list[i - 1].pos)) { list.forEach((x, i) => edit('item', x, { pos: i })); list = itemsOf(s.id); }
  const i = list.findIndex(x => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = list[j], b = list[j + dir];
  edit('item', list[i], { pos: b ? (a.pos + b.pos) / 2 : a.pos + dir });
  drawItems(s);
}
$('#set-items').addEventListener('click', e => {
  const card = e.target.closest('.itc'), s = curSet(); if (!card || !s) return;
  const mv = e.target.closest('[data-mv]');
  if (mv) { if (canEdit(s.team)) moveItem(s, card.dataset.it, +mv.dataset.mv); return; }
  go('item', { id: s.id, item: card.dataset.it });
});
function bindSet(sel, f, ev = 'input') {
  $(sel).addEventListener(ev, () => { const s = curSet(); if (!s) return; edit('set', s, f($(sel).value)); });
}
bindSet('#set-name', v => ({ name: v }));
bindSet('#set-date', v => ({ date: v }), 'change');
bindSet('#set-notes', v => ({ notes: v }));
$('#set-add').onclick = () => { const s = curSet(); if (s && canEdit(s.team)) songPicker(s); };
function songPicker(set) {
  const sh = sheet('<p>Ajouter un chant</p><input class="fld pq" placeholder="Rechercher ou taper un nouveau titre…" autocomplete="off"><div class="pick"></div><button class="cancel">Fermer</button>');
  const q = sh.querySelector('.pq'), box = sh.querySelector('.pick');
  const draw = () => {
    const v = clean(q.value).toLowerCase(), inSet = new Set(itemsOf(set.id).map(i => i.songId));
    const list = [...songs.values()].filter(s => (s.team || '') === (set.team || '') && clean(s.title || '') && (!v || [s.title, s.artist].join(' ').toLowerCase().includes(v))).sort(cmpTitle);
    box.innerHTML = (v && !list.some(s => clean(s.title).toLowerCase() === v) ? `<button class="create">+ Créer le chant « ${esc(clean(q.value))} »</button>` : '')
      + list.map(s => `<button data-pick="${esc(s.id)}"><b>${esc(clean(s.title))}</b>${inSet.has(s.id) ? '<em class="in">déjà dans le set</em>' : ''}${s.key ? `<span class="key">${esc(keyLabel(s.key))}</span>` : ''}</button>`).join('')
      || `<p class="empty-st">${v ? '' : 'Ta bibliothèque est vide : tape un titre pour créer un chant.'}</p>`;
  };
  q.addEventListener('input', draw); draw();
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const b = box.querySelector('button'); if (b) b.click(); } });
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    let song;
    if (b.classList.contains('create')) song = create('song', { title: clean(q.value), artist: '', key: '', bpm: '', sig: '', dur: 0, style: '', struct: [], links: '', notes: '' }, set.team);
    else song = songs.get(b.dataset.pick);
    if (!song) return;
    const list = itemsOf(set.id);
    create('item', { setId: set.id, songId: song.id, title: clean(song.title), key: null, struct: null, lead: '', note: '', pos: list.length ? list[list.length - 1].pos + 1 : 0 }, set.team);
    drawItems(set);
    toast('« ' + clean(song.title) + ' » ajouté au set');
    q.value = ''; draw();
  });
}
$('#set-dup').onclick = async () => {
  const s = curSet(); if (!s || !canEdit(s.team)) return;
  const c = create('set', { name: (clean(s.name || '') || 'Set') + ' (copie)', date: todayISO(), notes: s.notes || '' }, s.team);
  for (const it of itemsOf(s.id)) create('item', { setId: c.id, songId: it.songId, title: it.title, key: it.key || null, struct: it.struct || null, lead: it.lead || '', note: it.note || '', pos: it.pos }, s.team);
  nav.pop(); nav.push({ v: 'set', id: c.id }); render(true);
  toast('Set dupliqué (sans les enregistrements)');
};
$('#set-del').onclick = () => {
  const s = curSet(); if (!s) return;
  ask('Supprimer ce set ? Ses enregistrements seront supprimés aussi.', () => {
    for (const it of itemsOf(s.id)) { for (const r of recsOf(it.id)) remove('rec', r); remove('item', it); }
    remove('set', s); nav.pop(); render();
  });
};

// ---------- Un chant dans un set (réglages du jour) ----------
const curItem = () => {
  const t = topNav(); if (!t || t.v !== 'item') return null;
  const set = sets.get(t.id), it = items.get(t.item);
  return set && it && !it.deleted ? { set, it, song: songs.get(it.songId) } : null;
};
function renderItem() {
  const c = curItem(); if (!c) { nav.pop(); return render(); }
  const { set, it, song } = c;
  $('#it-num').textContent = itemsOf(set.id).indexOf(it) + 1;
  $('#it-title').textContent = itemTitle(it);
  $('#it-open').classList.toggle('hidden', !song);
  $('#it-info').textContent = song ? [song.key && 'Tonalité d\'origine : ' + keyLabel(song.key), song.bpm && song.bpm + ' BPM', song.sig, song.style].filter(Boolean).join(' · ') : 'Ce chant a été supprimé de la bibliothèque.';
  $('#it-mod').textContent = modLine(it);
  drawItemKey(c); drawMetroBtns();
  setV('#it-lead', it.lead || ''); setV('#it-note', it.note || '');
  $('#it-reset').classList.toggle('hidden', !it.struct);
  itSt.draw();
  renderRecs($('#it-recs'), it.id, () => itemRecTitles(c), [], { st: itemSt(it), pick: it });
  drawItemListen(c);
  drawPnote('#it-mine', '#it-pnote', it);
}
function drawItemKey({ it, song }) {
  $('#it-key').textContent = it.key ? keyLabel(it.key) + (song && song.key && song.key !== it.key ? ' (orig. ' + keyLabel(song.key) + ')' : '') : song && song.key ? keyLabel(song.key) : '—';
}
function itemRecTitles({ set, it }) {
  const t = itemTitle(it), k = itemKey(it) ? keyLabel(itemKey(it)) : '', d = dShort(set.date);
  return [[t, k, d].filter(Boolean).join(' – '), t, [t, k].filter(Boolean).join(' – '), [t, d].filter(Boolean).join(' – '), clean(set.name || '') && t + ' – ' + clean(set.name)];
}
const itSt = structEditor($('#it-struct'), () => { const c = curItem(); return c ? itemSt(c.it) : []; },
  st => { const c = curItem(); if (!c) return; edit('item', c.it, { struct: st }); $('#it-reset').classList.remove('hidden'); });
$('#it-reset').onclick = () => { const c = curItem(); if (!c) return; edit('item', c.it, { struct: null }); itSt.draw(); $('#it-reset').classList.add('hidden'); };
$('#it-key').onclick = () => {
  const c = curItem(); if (!c || !canEdit(c.it.team)) return;
  keySheet(itemKey(c.it), k => { edit('item', c.it, { key: k && !(c.song && k === c.song.key) ? k : null }); drawItemKey(c); },
    c.song && c.song.key ? 'Comme le chant (' + keyLabel(c.song.key) + ')' : 'Aucune');
};
for (const [sel, f] of [['#it-lead', v => ({ lead: v })], ['#it-note', v => ({ note: v })]])
  $(sel).addEventListener('input', () => { const c = curItem(); if (c) edit('item', c.it, f($(sel).value)); });
bindPnote('#it-pnote', () => (curItem() || {}).it);
$('#it-open').onclick = () => { const c = curItem(); if (c && c.song) go('song', { id: c.song.id }); };
$('#it-del').onclick = () => {
  const c = curItem(); if (!c) return;
  ask('Retirer ce chant du set ?' + (recsOf(c.it.id).length ? ' Ses enregistrements seront supprimés.' : ''), async () => {
    if (rec) await stopRec();
    for (const r of recsOf(c.it.id)) remove('rec', r);
    remove('item', c.it);
    nav.pop(); render();
  });
};
$('#it-rec').onclick = () => {
  if (rec) return stopRec();
  const c = curItem(); if (!c) return;
  partSheet(itemSt(c.it), 'Que vas-tu enregistrer ?', part => recToggle(withPart(itemRecTitles(c)[0], part), newRec(c.it.id, c.it.team, '', part)));
};


// =====================================================================
// =====================  Mode scène  ==================================
// =====================================================================
// Plein écran, gros caractères, toujours sombre. On passe d'un chant à l'autre en balayant,
// avec les flèches, ou avec une pédale Bluetooth (touches Page suivante / précédente).
// L'écran reste allumé. Dans une équipe, un responsable peut « Diriger » : les autres membres
// en mode scène suivent alors automatiquement le chant en cours.
let wakeLock = null, stageCh = null, stageLead = false, stageFollow = true, stageLeadT = null, leaderSeen = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    else if (!on && wakeLock) { const w = wakeLock; wakeLock = null; await w.release(); }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { const t = topNav(); if (!document.hidden && t && t.v === 'stage') keepAwake(true); });
function openStage(set, i = 0) {
  stageLead = false; stageFollow = true; leaderSeen = null;
  go('stage', { id: set.id, i });
  stageJoin(set);
  keepAwake(true);
  try { const d = document.documentElement; if (d.requestFullscreen && !document.fullscreenElement) d.requestFullscreen().catch(() => {}); } catch (e) {}
}
function closeStage() {
  stageArmed = false;
  if (M.src === 'stage') metroStop();
  keepAwake(false); stageLeave();
  try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e) {}
}
function renderStage(t) {
  const set = sets.get(t.id), its = itemsOf(set.id);
  $('#st-set').textContent = clean(set.name || '') || 'Set';
  if (!its.length) {
    $('#st-pos').textContent = ''; $('#st-title').textContent = 'Aucun chant dans ce set';
    for (const id of ['#st-key', '#st-orig', '#st-meta', '#st-lead-name', '#st-note', '#st-pnote', '#st-next']) $(id).textContent = '';
    html($('#st-pills'), ''); $('#st-prev').disabled = $('#st-nextb').disabled = true;
    return;
  }
  t.i = Math.max(0, Math.min(t.i || 0, its.length - 1));
  const it = its[t.i], song = songs.get(it.songId), k = itemKey(it), nx = its[t.i + 1];
  $('#st-pos').textContent = 'Chant ' + (t.i + 1) + ' / ' + its.length;
  $('#st-title').textContent = itemTitle(it);
  $('#st-key').textContent = k ? keyLabel(k) : '';
  $('#st-orig').textContent = it.key && song && song.key && it.key !== song.key ? 'orig. ' + keyLabel(song.key) : '';
  $('#st-meta').textContent = [song && song.bpm && song.bpm + ' BPM', song && song.sig, song && song.style].filter(Boolean).join(' · ');
  html($('#st-pills'), pillsHTML(itemSt(it)) || '');
  $('#st-lead-name').textContent = it.lead ? 'Lead : ' + it.lead : '';
  $('#st-note').textContent = it.note ? '↳ ' + it.note : '';
  const pn = [pnoteOf(it.id), song && pnoteOf(song.id)].filter(x => x && clean(x.text || '')).map(x => clean(x.text)).join(' · ');
  $('#st-pnote').textContent = pn ? '✎ ' + pn : '';
  $('#st-next').textContent = nx ? 'Ensuite : ' + itemTitle(nx) + (itemKey(nx) ? ' — ' + keyLabel(itemKey(nx)) : '') : 'Dernier chant du set';
  $('#st-prev').disabled = t.i === 0; $('#st-nextb').disabled = !nx;
  stageMetroSync();
  const team = !!(set.team && user && stageCh);
  $('#st-lead').classList.toggle('hidden', !(team && canEdit(set.team)));
  $('#st-lead').classList.toggle('on', stageLead);
  $('#st-lead').textContent = stageLead ? 'Je dirige ✓' : 'Diriger';
  const leading = leaderSeen && Date.now() - leaderSeen.at < 12000 && !stageLead;
  $('#st-follow').classList.toggle('hidden', !(team && leading));
  $('#st-follow').classList.toggle('on', stageFollow);
  $('#st-follow').textContent = stageFollow ? 'Je suis ✓' : 'Suivre';
  $('#st-leader').classList.toggle('hidden', !leading);
  $('#st-leader').textContent = leading ? (memberName(set.team, leaderSeen.by)) + ' dirige le set' + (stageFollow ? '' : ' (tu ne suis pas)') : '';
}
function stageGo(d, abs) {
  const t = topNav(); if (!t || t.v !== 'stage') return;
  const n = itemsOf(t.id).length; if (!n) return;
  const i = Math.max(0, Math.min(n - 1, abs != null ? abs : (t.i || 0) + d));
  if (i === t.i) return;
  t.i = i;
  const m = document.querySelector('.stmain'); m.classList.add('fade');
  setTimeout(() => { render(); m.classList.remove('fade'); m.scrollTop = 0; }, 120);
  if (stageLead && abs == null) stageSend();
}
$('#st-prev').onclick = () => stageGo(-1);
$('#st-nextb').onclick = () => stageGo(1);
{
  let sx = null, sy = 0;
  $('#stage').addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  $('#stage').addEventListener('touchend', e => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) stageGo(dx < 0 ? 1 : -1);
  });
}
document.addEventListener('keydown', e => {
  const t = topNav(); if (!t || t.v !== 'stage' || document.querySelector('.sheet')) return;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); stageGo(1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); stageGo(-1); }
  else if (e.key === 'Escape') goBack();
});
// Diriger / suivre (diffusion en temps réel entre les membres de l'équipe en mode scène)
function stageJoin(set) {
  stageLeave();
  if (!sb || !user || !set.team) return;
  try {
    stageCh = sb.channel('stage-' + set.id, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'pos' }, ({ payload }) => {
        const t = topNav(); if (!t || t.v !== 'stage' || t.id !== set.id || !payload) return;
        leaderSeen = { by: payload.by, at: Date.now() };
        if (stageLead && payload.by !== user.id) { stageLead = false; clearInterval(stageLeadT); } // un autre responsable a pris la main
        if (stageFollow && !stageLead) {
          const its = itemsOf(set.id), i = its.findIndex(x => x.id === payload.item);
          const target = i >= 0 ? i : payload.i;
          if (typeof target === 'number' && target !== t.i) { stageGo(0, target); return; }
        }
        render();
      })
      .subscribe();
  } catch (e) { stageCh = null; }
}
function stageLeave() {
  clearInterval(stageLeadT); stageLeadT = null; stageLead = false;
  if (stageCh) { try { sb.removeChannel(stageCh); } catch (e) {} stageCh = null; }
}
function stageSend() {
  const t = topNav(); if (!stageCh || !t || t.v !== 'stage') return;
  const it = itemsOf(t.id)[t.i];
  try { const r = stageCh.send({ type: 'broadcast', event: 'pos', payload: { i: t.i, item: it && it.id, by: user.id } }); if (r && r.catch) r.catch(() => {}); } catch (e) {}
}
$('#st-lead').onclick = () => {
  stageLead = !stageLead;
  clearInterval(stageLeadT);
  if (stageLead) { stageSend(); stageLeadT = setInterval(stageSend, 4000); toast('Tu diriges : les membres en mode scène suivent ton défilement.'); }
  render();
};
$('#st-follow').onclick = () => {
  stageFollow = !stageFollow;
  render();
};
setInterval(() => { const t = topNav(); if (t && t.v === 'stage' && leaderSeen) render(); }, 5000);
$('#set-play').onclick = () => { const s = curSet(); if (s) openStage(s, 0); };

// =====================================================================
// =====================  Partage d'un set  ============================
// =====================================================================
// Texte du set à partager. wa = mise en forme WhatsApp (*gras*, _italique_) ; sinon texte simple.
function setText(set, wa = true) {
  const B = t => wa ? '*' + t + '*' : t, It = t => wa ? '_' + t + '_' : t;
  const its = itemsOf(set.id), d = dParse(set.date);
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const sep = '━━━━━━━━━━━━━━';
  const L = ['🎵 ' + B((clean(set.name || '') || 'Set').toUpperCase())];
  if (d) L.push('📅 ' + cap(d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })));
  L.push('🎶 ' + setSummary(set), sep, '');
  its.forEach((it, i) => {
    const song = songs.get(it.songId), k = itemKey(it), st = itemSt(it);
    if (i) L.push('');
    L.push(B((i + 1) + '. ' + itemTitle(it)));
    const keyTxt = k ? keyLabel(k) + (it.key && song && song.key && it.key !== song.key ? ' ' + It('(orig. ' + keyLabel(song.key) + ')') : '') : '';
    const meta = [keyTxt, song && song.bpm && song.bpm + ' BPM', song && song.sig, song && song.style].filter(Boolean).join(' · ');
    if (meta) L.push('♪ ' + meta);
    if (st.length) L.push('▸ ' + st.map(x => secLabel(x) + (x.x > 1 ? ' ×' + x.x : '') + (x.i ? ' ' + It('(' + x.i + ')') : '')).join(' → '));
    if (it.lead) L.push('• Lead : ' + it.lead);
    if (it.note) L.push('↳ ' + It(it.note));
  });
  if (!its.length) L.push(It('Aucun chant pour l\'instant.'));
  const yt = setYtIds(set);
  if (yt.length) L.push('', sep, '▶ ' + B('Playlist YouTube'), ytWatch(yt));
  if (clean(set.notes || '')) L.push('', sep, '✎ ' + B('Notes'), set.notes.trim());
  return L.join('\n');
}
function printSet(set) {
  const its = itemsOf(set.id), d = dParse(set.date);
  html($('#print'), `<h1>${esc(clean(set.name || '') || 'Set')}</h1><p class="sub">${esc([d && d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), setSummary(set)].filter(Boolean).join(' · '))}</p>`
    + its.map((it, i) => {
      const song = songs.get(it.songId), k = itemKey(it);
      const meta = [it.key && song && song.key && it.key !== song.key && 'orig. ' + keyLabel(song.key), song && song.bpm && song.bpm + ' BPM', song && song.sig, song && song.style, it.lead && 'Lead : ' + it.lead].filter(Boolean).join(' · ');
      return `<div class="it"><span class="n">${i + 1}</span><div class="b"><div><span class="t">${esc(itemTitle(it))}</span>${k ? `<span class="k">${esc(keyLabel(k))}</span>` : ''}</div>${meta ? `<div class="m">${esc(meta)}</div>` : ''}${pillsHTML(itemSt(it))}${it.note ? `<div class="m">↳ ${esc(it.note)}</div>` : ''}</div></div>`;
    }).join('') + (clean(set.notes || '') ? `<div class="notes"><b>Notes :</b> ${esc(set.notes.trim())}</div>` : ''));
  setTimeout(() => window.print(), 50);
}
$('#set-share').onclick = () => {
  const set = curSet(); if (!set) return;
  let wa = pref('shareFmt', 'wa') === 'wa';
  const sh = sheet('<p>Partager le set</p><div class="seg"><button data-f="wa">WhatsApp</button><button data-f="txt">Texte simple</button></div><pre class="preview"></pre><button class="ok send">Envoyer (WhatsApp, SMS…)</button><button class="alt copy">Copier le texte</button><button class="alt pdf">PDF / imprimer</button><button class="cancel">Fermer</button>');
  const text = () => setText(set, wa);
  const draw = () => {
    sh.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', (x.dataset.f === 'wa') === wa));
    // Aperçu : le gras et l'italique sont montrés comme WhatsApp les affichera
    const t = esc(text());
    sh.querySelector('.preview').innerHTML = wa ? t.replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|[\s(])_([^_\n]+)_/g, '$1<i>$2</i>') : t;
  };
  draw();
  sh.querySelector('.send').classList.toggle('hidden', !navigator.share);
  sh.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.f) { wa = b.dataset.f === 'wa'; setPref('shareFmt', wa ? 'wa' : 'txt'); draw(); }
    else if (b.classList.contains('send')) navigator.share({ text: text() }).catch(() => {});
    else if (b.classList.contains('copy')) {
      try { await navigator.clipboard.writeText(text()); toast('Texte copié : colle-le dans WhatsApp ou un SMS.'); }
      catch (er) { const r = document.createRange(); r.selectNodeContents(sh.querySelector('.preview')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Texte sélectionné : copie-le.'); }
    } else if (b.classList.contains('pdf')) { sh.remove(); printSet(set); }
  });
};

// =====================================================================
// ==========  Fonctionnement sans Internet (service worker)  ==========
// =====================================================================
// L'app elle-même est gardée sur l'appareil : elle s'ouvre même sans réseau. Les modifications
// faites hors ligne sont envoyées au retour du réseau.
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(e => console.warn('hors ligne indisponible', e));


// =====================================================================
// =====================  Métronome  ===================================
// =====================================================================
// Son généré sur l'appareil (Web Audio) avec une programmation en avance des « clics » pour un
// tempo régulier. Premier temps de la mesure accentué. 6/8 et 12/8 : battue à la noire pointée.
const beatsOf = sig => ({ '3/4': 3, '2/4': 2, '6/8': 2, '12/8': 4 })[sig] || 4;
const M = { ctx: null, on: false, src: '', bpm: 100, beats: 4, beat: 0, next: 0, timer: null, onBeat: null };
function metroStart(bpm, beats, onBeat, src) {
  metroStop();
  // iPhone / iPad : jouer le son même si le bouton silencieux est activé
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  const AC = window.AudioContext || window.webkitAudioContext;
  try { if (AC && !M.ctx) M.ctx = new AC(); if (M.ctx && M.ctx.state !== 'running') M.ctx.resume(); } catch (e) { M.ctx = null; }
  Object.assign(M, { on: true, src, bpm, beats, beat: 0, onBeat, next: M.ctx ? M.ctx.currentTime + 0.08 : 0 });
  if (!M.ctx) { // pas de son possible : clignotement seul
    M.timer = setInterval(() => { onBeat && onBeat(M.beat); M.beat = (M.beat + 1) % M.beats; }, 60000 / bpm);
    return;
  }
  const tick = () => {
    if (!M.on) return;
    while (M.next < M.ctx.currentTime + 0.12) {
      const b = M.beat, t = M.next;
      metroClick(t, b === 0 && M.beats > 1);
      setTimeout(() => { if (M.on && M.onBeat === onBeat && onBeat) onBeat(b); }, Math.max(0, (t - M.ctx.currentTime) * 1000));
      M.next += 60 / M.bpm; M.beat = (M.beat + 1) % M.beats;
    }
  };
  tick(); M.timer = setInterval(tick, 25);
}
function metroClick(t, acc) {
  const c = M.ctx, o = c.createOscillator(), g = c.createGain();
  o.type = 'sine'; o.frequency.value = acc ? 1760 : 1100;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(acc ? 0.9 : 0.5, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.08);
}
function metroStop() {
  clearInterval(M.timer); M.timer = null; M.on = false; M.onBeat = null; M.src = '';
  document.querySelectorAll('.beats i, .stbeat i').forEach(i => i.classList.remove('on'));
  drawMetroBtns();
}
function drawBeats(el, n, b) {
  if (!el) return;
  if (el.children.length !== n) el.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i === 0 && n > 1 ? 'acc' : ''}"></i>`).join('');
  [...el.children].forEach((x, i) => x.classList.toggle('on', i === b));
}
document.addEventListener('visibilitychange', () => { if (document.hidden && M.on) { stageArmed = false; metroStop(); } });
function drawMetroBtns() {
  const lbl = s => s && s.bpm ? 'Métronome · ' + s.bpm + ' BPM' + (s.sig ? ' · ' + s.sig : '') : 'Métronome';
  const s = curSong(); if (s) $('#s-metro').textContent = lbl(s);
  const c = curItem(); if (c) $('#it-metro').textContent = lbl(c.song);
  const t = topNav();
  if (t && t.v === 'stage') {
    const sg = stageSong();
    $('#st-metro').classList.toggle('hidden', !(sg && +sg.bpm));
    $('#st-metro').classList.toggle('on', M.on && M.src === 'stage');
    $('#st-metro').textContent = '♩ ' + ((sg && sg.bpm) || '');
    if (!(M.on && M.src === 'stage')) $('#st-beat').innerHTML = '';
  }
}
function metroSheet(song) {
  if (!song) { toast('Ce chant n\'est plus dans la bibliothèque.'); return; }
  const ed = canEdit(song.team);
  let bpm = +song.bpm || 100;
  const beats = beatsOf(song.sig);
  const sh = sheet(`<p></p><div class="mbpm"><span class="v"></span><small>BPM · ${esc(song.sig || '4/4')}</small></div><div class="beats"></div>`
    + '<div class="mrow"><button data-d="-5">−5</button><button data-d="-1">−1</button><button class="tap">Taper</button><button data-d="1">+1</button><button data-d="5">+5</button></div>'
    + '<button class="ok mgo">Démarrer</button>' + (ed ? '<button class="alt save hidden">Enregistrer ce tempo dans la fiche</button>' : '') + '<button class="cancel">Fermer</button>');
  sh.querySelector('p').textContent = 'Métronome — ' + (clean(song.title || '') || 'Chant');
  const beatsEl = sh.querySelector('.beats');
  const upd = () => {
    sh.querySelector('.v').textContent = bpm;
    const sv = sh.querySelector('.save'); if (sv) sv.classList.toggle('hidden', String(bpm) === String(song.bpm || ''));
    sh.querySelector('.mgo').textContent = M.on && M.src === 'sheet' ? 'Arrêter' : 'Démarrer';
  };
  drawBeats(beatsEl, beats, -1); upd();
  let taps = [];
  sh.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.d) { bpm = Math.max(30, Math.min(300, bpm + +b.dataset.d)); M.bpm = bpm; }
    else if (b.classList.contains('tap')) {
      // Tempo au doigt : moyenne des derniers intervalles entre les touchers
      const now = performance.now(); taps = taps.filter(x => now - x < 2500); taps.push(now);
      if (taps.length >= 2) { const k = taps.slice(-5); bpm = Math.max(30, Math.min(300, Math.round(60000 * (k.length - 1) / (k[k.length - 1] - k[0])))); M.bpm = bpm; }
    }
    else if (b.classList.contains('mgo')) { if (M.on && M.src === 'sheet') metroStop(); else metroStart(bpm, beats, i => drawBeats(beatsEl, beats, i), 'sheet'); }
    else if (b.classList.contains('save')) { edit('song', song, { bpm: String(bpm) }); toast('Tempo enregistré : ' + bpm + ' BPM'); render(); }
    else return;
    upd();
  });
  // Fermer la fenêtre arrête le métronome
  const obs = new MutationObserver(() => { if (!sh.isConnected) { if (M.src === 'sheet') metroStop(); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
}
$('#s-metro').onclick = () => metroSheet(curSong());
$('#it-metro').onclick = () => { const c = curItem(); if (c) metroSheet(c.song); };
// Mode scène : le métronome suit le chant affiché
const stageSong = () => { const t = topNav(); if (!t || t.v !== 'stage') return null; const it = itemsOf(t.id)[t.i || 0]; return it ? songs.get(it.songId) : null; };
// stageArmed : le métronome a été lancé en mode scène et pas arrêté → il reprend au tempo de
// chaque chant (et se tait sur un chant sans tempo).
let stageArmed = false;
function stageMetroSync() {
  if (stageArmed) {
    const sg = stageSong(), bpm = sg && +sg.bpm, beats = beatsOf(sg && sg.sig);
    if (!bpm) { if (M.on && M.src === 'stage') metroStop(); }
    else if (!(M.on && M.src === 'stage') || bpm !== M.bpm || beats !== M.beats) metroStart(bpm, beats, i => drawBeats($('#st-beat'), beats, i), 'stage');
  }
  drawMetroBtns();
}
$('#st-metro').onclick = () => {
  if (M.on && M.src === 'stage') { stageArmed = false; metroStop(); }
  else { stageArmed = true; stageMetroSync(); }
  drawMetroBtns();
};

// =====================================================================
// =====================  Playlist YouTube  ============================
// =====================================================================
// YouTube crée une playlist temporaire à partir d'une liste de vidéos (sans compte ni clé).
// On prend le premier lien YouTube de la fiche de chaque chant, dans l'ordre du set.
function ytId(u) { const m = String(u || '').match(/(?:youtu\.be\/|[?&]v=|\/(?:embed|shorts|live|v)\/)([\w-]{11})(?![\w-])/); return m ? m[1] : null; }
// Versions YouTube d'un chant : liste « videos » [{ id, label }] (la première = par défaut),
// plus les liens YouTube encore écrits dans « liens » (anciennes fiches).
function songVideos(song) {
  if (!song) return [];
  const out = [], seen = new Set();
  for (const v of Array.isArray(song.videos) ? song.videos : []) if (v && v.id && !seen.has(v.id)) { seen.add(v.id); out.push({ id: v.id, label: v.label || '' }); }
  for (const line of String(song.links || '').split('\n')) { const id = ytId(line); if (id && !seen.has(id)) { seen.add(id); out.push({ id, label: clean(line.replace(/https?:\/\/\S+/g, '')) }); } }
  return out;
}
const songYt = song => (songVideos(song)[0] || {}).id || null;
// Version choisie pour un chant d'un set (sinon la version par défaut du chant)
const itemYt = it => { const song = songs.get(it.songId), vs = songVideos(song); return it.video && vs.some(v => v.id === it.video) ? it.video : (vs[0] || {}).id || null; };
const setYtIds = set => itemsOf(set.id).map(itemYt).filter(Boolean);
const vidName = (v, i) => clean(v.label || '') || 'Version ' + (i + 1);
// Enregistre la liste des versions ; les liens YouTube sortent du champ « liens »
function saveVideos(song, list) {
  edit('song', song, { videos: list.map(v => ({ id: v.id, label: clean(v.label || '') })), links: String(song.links || '').split('\n').filter(l => !ytId(l)).join('\n').trim() });
  if (curSong() === song) { setV('#s-links', song.links); drawLinks(song); }
}
const ytWatch = ids => 'https://www.youtube.com/watch_videos?video_ids=' + ids.join(',');
// Lecteur YouTube piloté par l'app (interface officielle « IFrame Player API ») : c'est l'app qui
// lance chaque vidéo et passe au chant suivant à la fin, donc la liste et la vidéo correspondent
// toujours. Si l'interface ne se charge pas, on revient au lecteur simple.
let ytApi = null;
function loadYtApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApi) return ytApi;
  ytApi = new Promise((res, rej) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(window.YT); };
    const sc = document.createElement('script');
    sc.src = 'https://www.youtube.com/iframe_api';
    sc.onerror = () => { ytApi = null; rej(new Error('YouTube injoignable')); };
    document.head.append(sc);
    setTimeout(() => { if (!(window.YT && window.YT.Player)) { ytApi = null; rej(new Error('délai')); } }, 8000);
  });
  return ytApi;
}
// =====================================================================
// =====================  Écouter le set  ==============================
// =====================================================================
// Pour chaque chant : enregistrement de répétition (fait dans ce set), enregistrement de
// référence (fiche du chant) et/ou vidéo YouTube. La lecture enchaîne les chants dans l'ordre du
// set ; « Enregistrements » ou « YouTube » indique la version jouée en priorité.
// Les enregistrements sont lus depuis l'appareil : sans pub et même sans Internet.
const SRC_NAME = { off: '★ Officiel', rep: 'Répétition', ref: 'Fiche', yt: 'YouTube' };
function listenSheet(set) {
  let mode = pref('listenMode', 'rec');
  const sh = sheet('<p>Écouter le set</p><div class="seg"><button data-m="rec">Enregistrements</button><button data-m="yt">YouTube</button></div>'
    + '<div class="ytframe hidden"><div class="ytp"></div></div>'
    + '<div class="aplayer hidden"><button class="apl" type="button" aria-label="Lecture / pause"></button><div class="amid"><b class="at"></b><span class="abar"><i></i></span></div><span class="atime"></span></div>'
    + '<small class="ys"></small><div class="ytlist"></div><button class="alt open">Ouvrir la playlist dans YouTube</button><button class="alt copy">Copier le lien de la playlist YouTube</button><button class="cancel">Fermer</button>');
  const box = sh.querySelector('.ytframe'), ap = sh.querySelector('.aplayer');
  let cur = -1, curKind = null, player = null, ready = false, fallback = false, fbShown = null, pendingYt = null;
  const bad = new Set(), missing = new Set();
  const audio = new Audio(); audio.preload = 'auto';
  const entries = () => itemsOf(set.id).map(it => {
    const song = songs.get(it.songId), off = officialOf(it.songId);
    // Écoute : seulement les enregistrements du chant complet
    const lr = listenRecOf(it), rep = lr && lr !== off ? lr : null;
    const ref = song && !off ? fullRecs(song.id).slice(-1)[0] || null : null;
    return { it, song, off, rep, ref, yt: itemYt(it), vids: songVideos(song) };
  });
  // Versions jouables d'un chant, dans l'ordre de préférence : choix du set (« À écouter »),
  // sinon l'officiel d'abord ; « YouTube » en haut de la fenêtre met YouTube en premier.
  const sources = e => {
    const r = k => e[k] && !missing.has(e[k].id) && { k, rec: e[k] };
    const y = e.yt && !bad.has(e.yt) ? { k: 'yt', id: e.yt } : null;
    const order = mode === 'yt' || e.it.listen === 'yt' ? [y, r('off'), r('rep'), r('ref')] : e.it.listen === 'rep' ? [r('rep'), r('off'), r('ref'), y] : [r('off'), r('rep'), r('ref'), y];
    return order.filter(Boolean);
  };
  // Les enregistrements sont préparés dès l'ouverture (lecture immédiate au toucher)
  for (const e of entries()) for (const r of [e.off, e.rep, e.ref]) if (r) loadAudio(r.id);
  const stopAll = () => { audio.pause(); try { if (player && ready) player.pauseVideo(); } catch (er) {} };
  function play(i, k, vid) {
    const es = entries();
    if (i < 0 || i >= es.length) { stopAll(); cur = -1; curKind = null; draw(); return; }
    const list = sources(es[i]);
    let src = (k && list.find(x => x.k === k)) || list[0];
    if (vid) src = { k: 'yt', id: vid }; // version YouTube choisie avec ▾
    if (!src) return play(i + 1, null); // rien à écouter pour ce chant : on passe au suivant
    cur = i; curKind = src.k; stopAll();
    if (src.k === 'yt') { ap.classList.add('hidden'); box.classList.remove('hidden'); ytPlay(src.id); }
    else {
      box.classList.add('hidden'); ap.classList.remove('hidden');
      const url = urls[src.rec.id];
      if (!url) {
        // Audio pas encore sur cet appareil : on le récupère, sinon on passe à la version suivante
        missing.add(src.rec.id); draw();
        if (user) fetchMissingAudio().then(() => loadAudio(src.rec.id)).then(() => { if (urls[src.rec.id]) { missing.delete(src.rec.id); if (cur === i) play(i, src.k); } });
        return play(i, null);
      }
      audio.src = url; audio.currentTime = 0;
      audio.play().catch(() => { toast('Touche ▶ pour lancer la lecture.'); });
      sh.querySelector('.at').innerHTML = esc(itemTitle(es[i].it)) + ' <em>· ' + SRC_NAME[src.k] + '</em>';
    }
    draw();
  }
  const next = () => play(cur + 1, null);
  audio.addEventListener('ended', next);
  audio.addEventListener('play', () => drawAp()); audio.addEventListener('pause', () => drawAp());
  audio.addEventListener('timeupdate', () => drawAp());
  function drawAp() {
    sh.querySelector('.apl').innerHTML = audio.paused ? I.play : I.pause;
    const d = audio.duration || 0;
    sh.querySelector('.abar i').style.width = d ? Math.min(100, audio.currentTime / d * 100) + '%' : '0';
    sh.querySelector('.atime').textContent = fmt(audio.currentTime) + (d && isFinite(d) ? ' / ' + fmt(d) : '');
  }
  sh.querySelector('.apl').onclick = () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); };
  sh.querySelector('.abar').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); if (audio.duration) audio.currentTime = (e.clientX - r.left) / r.width * audio.duration; };
  // Lecteur YouTube piloté par l'app (interface officielle) ; lecteur simple si elle ne se charge pas
  function ytPlay(id) {
    if (player && ready) { player.loadVideoById(id); return; }
    if (fallback) {
      if (fbShown !== id) { fbShown = id; box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&autoplay=1" title="Vidéo YouTube" allow="autoplay; encrypted-media; picture-in-picture; fullscreen"></iframe>`; }
      return;
    }
    pendingYt = id;
    if (player) return; // en cours de création : la vidéo sera lancée quand il sera prêt
    loadYtApi().then(YT => {
      if (!sh.isConnected || player) return;
      player = new YT.Player(sh.querySelector('.ytp'), {
        host: 'https://www.youtube-nocookie.com', videoId: pendingYt, width: '100%', height: '100%',
        playerVars: { playsinline: 1, rel: 0, autoplay: 1 },
        events: {
          onReady: () => { ready = true; if (pendingYt) { try { player.loadVideoById(pendingYt); } catch (er) {} } },
          onStateChange: e => { if (e.data === YT.PlayerState.ENDED) next(); },
          onError: () => { const e = entries()[cur]; if (e && e.yt) bad.add(e.yt); setTimeout(() => play(cur, null), 500); },
        },
      });
    }).catch(() => { fallback = true; if (curKind === 'yt') ytPlay(pendingYt); });
  }
  const draw = () => {
    sh.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x.dataset.m === mode));
    const es = entries(), withRec = es.filter(e => e.rep || e.ref).length, withYt = es.filter(e => e.yt).length;
    sh.querySelector('.ys').textContent = !es.length ? 'Aucun chant dans ce set.'
      : es.length + (es.length > 1 ? ' chants · ' : ' chant · ') + withRec + ' avec enregistrement · ' + withYt + ' avec YouTube · touche un chant pour le lancer';
    const ytIds = setYtIds(set);
    sh.querySelector('.open').classList.toggle('hidden', !ytIds.length);
    sh.querySelector('.copy').classList.toggle('hidden', !ytIds.length);
    html(sh.querySelector('.ytlist'), es.map((e, i) => {
      const isCur = i === cur, title = itemTitle(e.it), q = encodeURIComponent([title, e.song && e.song.artist].filter(Boolean).join(' '));
      const btn = (k, ok, off) => ok ? `<button class="src${isCur && curKind === k ? ' on' : ''}${off ? ' off' : ''}" data-k="${k}" type="button">${isCur && curKind === k ? '▶ ' : ''}${SRC_NAME[k]}</button>` : '';
      const srcs = btn('off', e.off, e.off && missing.has(e.off.id)) + btn('rep', e.rep, e.rep && missing.has(e.rep.id)) + btn('ref', e.ref, e.ref && missing.has(e.ref.id)) + btn('yt', e.yt, e.yt && bad.has(e.yt))
        + (e.vids.length > 1 ? '<button class="src vsel" data-v="1" type="button" aria-label="Choisir la version YouTube">▾</button>' : '');
      const editable = e.song && canEdit(e.song.team);
      return `<div class="lrow${isCur ? ' cur' : ''}" data-i="${i}" data-song="${esc(e.song ? e.song.id : '')}"><b>${i + 1}. ${esc(title)}</b><span class="srcs">${srcs || '<span class="none">rien à écouter</span>'}`
        + (!e.yt ? `<a href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">Chercher sur YouTube</a>${editable ? '<button class="add" type="button">Coller un lien</button>' : ''}` : '')
        + '</span></div>';
    }).join(''));
  };
  // ▾ : choisir une version YouTube ; les responsables la retiennent pour ce set
  function versionPicker(i) {
    const e = entries()[i]; if (!e) return;
    const p = sheet('<p></p><div class="pick"></div><button class="cancel">Annuler</button>');
    p.querySelector('p').textContent = 'Versions YouTube — ' + itemTitle(e.it);
    p.querySelector('.pick').innerHTML = e.vids.map((v, j) => `<button data-vid="${v.id}" class="${v.id === e.yt ? 'on' : ''}"><b>${esc(vidName(v, j))}</b><em>${j ? '' : 'par défaut'}${v.id === e.yt ? (j ? '' : ' · ') + 'choisie pour ce set' : ''}</em></button>`).join('');
    p.addEventListener('click', ev => {
      const b = ev.target.closest('[data-vid]'); if (!b) return;
      p.remove();
      if (canEdit(e.it.team)) { edit('item', e.it, { video: b.dataset.vid === (e.vids[0] || {}).id ? null : b.dataset.vid }); toast('Version retenue pour ce set'); }
      play(i, 'yt', b.dataset.vid);
    });
  }
  draw();
  sh.addEventListener('click', async e => {
    const b = e.target.closest('button'), row = e.target.closest('.lrow');
    if (b && b.dataset.m) { mode = b.dataset.m; setPref('listenMode', mode); draw(); return; }
    if (b && b.dataset.k && row) { play(+row.dataset.i, b.dataset.k); return; }
    if (b && b.dataset.v && row) { versionPicker(+row.dataset.i); return; }
    if (row && !b && !e.target.closest('a,input')) { play(+row.dataset.i, null); return; }
    if (!b) return;
    const ids = setYtIds(set);
    if (b.classList.contains('open')) { stopAll(); window.open(ytWatch(ids), '_blank', 'noopener'); }
    else if (b.classList.contains('copy')) { try { await navigator.clipboard.writeText(ytWatch(ids)); toast('Lien de la playlist copié'); } catch (er) { toast(ytWatch(ids)); } }
    else if (b.classList.contains('add') && row) {
      if (row.querySelector('input')) return;
      const inp = document.createElement('input'); inp.placeholder = 'Colle le lien YouTube du chant'; inp.setAttribute('inputmode', 'url');
      row.append(inp); inp.focus();
      inp.addEventListener('change', () => {
        const song = songs.get(row.dataset.song), id = ytId(inp.value);
        if (!song) return;
        if (!id) { toast('Ce n\'est pas un lien YouTube.'); return; }
        const vs = songVideos(song); if (!vs.some(v => v.id === id)) vs.push({ id, label: '' });
        saveVideos(song, vs);
        html(sh.querySelector('.ytlist'), ''); draw();
        toast('Lien ajouté à la fiche du chant');
      });
    }
  });
  // Fermer la fenêtre arrête la lecture
  const obs = new MutationObserver(() => { if (!sh.isConnected) { audio.pause(); audio.removeAttribute('src'); try { player && player.destroy(); } catch (er) {} obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
}
$('#set-yt').onclick = () => { const s = curSet(); if (s) listenSheet(s); };

// ---------- Versions YouTube dans la fiche du chant ----------
function drawVideos(s) {
  const vs = songVideos(s), ed = canEdit(s.team);
  const box = $('#s-vids');
  const sig = JSON.stringify([vs, ed]);
  if (box.__sig === sig) return;
  box.__sig = sig;
  box.innerHTML = vs.length ? vs.map((v, i) => `<div class="vrow" data-id="${v.id}"><button class="vdef${i ? '' : ' on'}" type="button" title="${i ? 'Définir par défaut' : 'Version par défaut'}"${ed ? '' : ' disabled'}>${i ? '☆' : '★'}</button><input class="vl" value="${esc(v.label || '')}" placeholder="${esc(vidName(v, i))}"${ed ? '' : ' disabled'}>${i ? '' : '<small>par défaut</small>'}<a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">Voir</a>${ed ? '<button class="vx" type="button" aria-label="Retirer">✕</button>' : ''}</div>`).join('')
    : '<span class="empty-st">Aucune vidéo pour l\'instant.</span>';
}
$('#s-vids').addEventListener('click', e => {
  const s = curSong(), row = e.target.closest('.vrow'); if (!s || !row || !canEdit(s.team)) return;
  const vs = songVideos(s), i = vs.findIndex(v => v.id === row.dataset.id); if (i < 0) return;
  if (e.target.closest('.vdef') && i > 0) { const [v] = vs.splice(i, 1); vs.unshift(v); saveVideos(s, vs); drawVideos(s); toast('« ' + vidName(v, 0) + ' » est la version par défaut'); }
  else if (e.target.closest('.vx')) { vs.splice(i, 1); saveVideos(s, vs); drawVideos(s); }
});
$('#s-vids').addEventListener('change', e => {
  const s = curSong(), row = e.target.closest('.vrow'); if (!s || !row || !e.target.classList.contains('vl')) return;
  const vs = songVideos(s), v = vs.find(x => x.id === row.dataset.id); if (!v) return;
  v.label = e.target.value; saveVideos(s, vs);
});
$('#s-vadd').onclick = () => {
  const s = curSong(); if (!s) return;
  const id = ytId($('#s-vurl').value);
  if (!id) { toast('Colle un lien YouTube valide.'); return; }
  const vs = songVideos(s);
  if (vs.some(v => v.id === id)) { toast('Cette vidéo est déjà dans les versions.'); return; }
  vs.push({ id, label: clean($('#s-vlabel').value) });
  saveVideos(s, vs); $('#s-vurl').value = ''; $('#s-vlabel').value = ''; drawVideos(s);
  toast(vs.length === 1 ? 'Vidéo ajoutée (version par défaut)' : 'Version ajoutée');
};

// ---------- Chant d'un set : version YouTube et enregistrement à écouter ----------
function drawItemListen({ it, song }) {
  const vs = songVideos(song);
  html($('#it-video'), (vs.length ? `<option value="">Par défaut (${esc(vidName(vs[0], 0))})</option>` : '<option value="">Aucune vidéo</option>')
    + vs.slice(1).map((v, i) => `<option value="${v.id}">${esc(vidName(v, i + 1))}</option>`).join(''));
  setV('#it-video', it.video && vs.some(v => v.id === it.video) && vs[0].id !== it.video ? it.video : '');
  $('#it-video').disabled = !canEdit(it.team) || vs.length < 2;
  setV('#it-listen', it.listen || '');
}
$('#it-video').addEventListener('change', () => { const c = curItem(); if (c) edit('item', c.it, { video: $('#it-video').value || null }); });
$('#it-listen').addEventListener('change', () => { const c = curItem(); if (c) edit('item', c.it, { listen: $('#it-listen').value || null }); });

// ---------- Importer un fichier audio (version de référence ou répétition) ----------
function importAudio(input, parentOf, titleOf) {
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0]; input.value = '';
    const p = parentOf(); if (!f || !p) return;
    if (!/^audio\//.test(f.type) && !/\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(f.name)) { toast('Ce fichier n\'est pas un fichier audio.'); return; }
    if (f.size > 45 * 1024 * 1024) { toast('Fichier trop lourd (45 Mo maximum).'); return; }
    const type = f.type || ({ mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', opus: 'audio/ogg' })[(f.name.split('.').pop() || '').toLowerCase()] || 'audio/mpeg';
    const blob = new Blob([await f.arrayBuffer()], { type });
    const u = URL.createObjectURL(blob);
    const d = await new Promise(res => { const a = new Audio(); a.preload = 'metadata'; a.onloadedmetadata = () => res(isFinite(a.duration) ? a.duration : 0); a.onerror = () => res(0); a.src = u; setTimeout(() => res(0), 5000); });
    const id = uid();
    await putAudio({ id, blob, d });
    urls[id] = u; memBlob(id, blob);
    const part = input.__part || ''; input.__part = '';
    newRec(p.id, p.team, '', part)(id, d, withPart(titleOf(p) || clean(f.name.replace(/\.[^.]+$/, '')), part));
    toast('Fichier audio ajouté');
  });
}
$('#s-imp').onclick = () => { const s = curSong(); if (s) partSheet(s.struct, 'Ce fichier est…', part => { $('#s-file').__part = part; $('#s-file').click(); }); };
$('#it-imp').onclick = () => { const c = curItem(); if (c) partSheet(itemSt(c.it), 'Ce fichier est…', part => { $('#it-file').__part = part; $('#it-file').click(); }); };
importAudio($('#s-file'), curSong, s => clean(s.title || '') ? clean(s.title) + ' – référence' : '');
importAudio($('#it-file'), () => (curItem() || {}).it, () => { const c = curItem(); return c ? itemRecTitles(c)[0] : ''; });


// =====================================================================
// =====================  Mode travail  ================================
// =====================================================================
// Lecteur pour apprendre : vitesse réduite sans changer la tonalité, boucle d'un passage (A → B)
// ou de tout l'enregistrement, ±5 s, barre de position avec le passage marqué.
let workSpeed = 1;
async function workSheet(id, title) {
  await loadAudio(id);
  if (!urls[id]) { toast('Audio pas encore disponible sur cet appareil.'); return; }
  const a = new Audio(urls[id]);
  a.preservesPitch = a.mozPreservesPitch = a.webkitPreservesPitch = true; // la tonalité ne change pas
  a.playbackRate = workSpeed;
  let A = null, B = null, loop = false, raf = 0;
  const sh = sheet('<p></p><div class="wkbar"><span class="wkab"></span><span class="wkfill"></span><span class="wkm wka">A</span><span class="wkm wkb">B</span></div><div class="wktime"><span class="cur">0:00</span><span class="dur"></span></div>'
    + '<div class="mrow wkmain"><button class="m5">−5 s</button><button class="ok wpl"></button><button class="p5">+5 s</button></div>'
    + '<small>Vitesse (la tonalité ne change pas)</small><div class="seg speeds">' + [0.5, 0.6, 0.75, 0.9, 1, 1.1].map(v => `<button data-sp="${v}">${Math.round(v * 100)} %</button>`).join('') + '</div>'
    + '<small>Boucle</small><div class="mrow"><button class="sa">Début A</button><button class="sb">Fin B</button><button class="lp">Boucle</button></div><small class="abinfo"></small>'
    + '<button class="alt clr hidden">Effacer le passage A-B</button><button class="cancel">Fermer</button>');
  sh.querySelector('p').textContent = 'Travailler — ' + title;
  const bar = sh.querySelector('.wkbar');
  const dur = () => (isFinite(a.duration) && a.duration) || 0;
  const draw = () => {
    const d = dur(), pct = t => d ? Math.max(0, Math.min(100, t / d * 100)) : 0;
    sh.querySelector('.wkfill').style.width = pct(a.currentTime) + '%';
    sh.querySelector('.cur').textContent = fmt(a.currentTime);
    sh.querySelector('.dur').textContent = d ? fmt(d) : '';
    const wa = sh.querySelector('.wka'), wb = sh.querySelector('.wkb'), ab = sh.querySelector('.wkab');
    wa.classList.toggle('hidden', A == null); wb.classList.toggle('hidden', B == null);
    if (A != null) wa.style.left = pct(A) + '%';
    if (B != null) wb.style.left = pct(B) + '%';
    const s0 = A != null ? A : 0, s1 = B != null ? B : d;
    ab.classList.toggle('hidden', !loop || !d);
    ab.style.left = pct(s0) + '%'; ab.style.width = Math.max(0, pct(s1) - pct(s0)) + '%';
    sh.querySelector('.wpl').innerHTML = a.paused ? I.play + ' Lecture' : I.pause + ' Pause';
    sh.querySelectorAll('[data-sp]').forEach(x => x.classList.toggle('on', +x.dataset.sp === a.playbackRate));
    sh.querySelector('.lp').classList.toggle('on', loop);
    sh.querySelector('.lp').textContent = loop ? 'Boucle : oui' : 'Boucle';
    sh.querySelector('.clr').classList.toggle('hidden', A == null && B == null);
    sh.querySelector('.abinfo').textContent = A != null || B != null ? 'Passage : ' + fmt(A || 0) + ' → ' + (B != null ? fmt(B) : 'fin') + (loop ? ' (en boucle)' : '') : loop ? 'Tout l\'enregistrement tourne en boucle.' : 'Marque le début (A) et la fin (B) d\'un passage pendant la lecture, puis active la boucle.';
  };
  // Surveillance fine de la position pour une boucle précise
  const watch = () => {
    if (loop) { const end = B != null ? B : dur(), start = A != null ? A : 0; if (end && a.currentTime >= end - 0.03) a.currentTime = start; }
    draw();
    if (!a.paused) raf = requestAnimationFrame(watch);
  };
  a.addEventListener('play', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(watch); draw(); });
  a.addEventListener('pause', draw); a.addEventListener('loadedmetadata', draw); a.addEventListener('timeupdate', draw);
  a.addEventListener('ended', () => { if (loop) { a.currentTime = A != null ? A : 0; a.play().catch(() => {}); } else draw(); });
  const seek = t => { a.currentTime = Math.max(0, Math.min(dur() || 0, t)); draw(); };
  bar.addEventListener('click', e => { const r = bar.getBoundingClientRect(); if (dur()) seek((e.clientX - r.left) / r.width * dur()); });
  sh.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.classList.contains('cancel')) return;
    if (b.classList.contains('wpl')) { if (a.paused) { if (loop && B != null && a.currentTime >= B) a.currentTime = A || 0; a.play().catch(() => toast('Lecture impossible')); } else a.pause(); }
    else if (b.classList.contains('m5')) seek(a.currentTime - 5);
    else if (b.classList.contains('p5')) seek(a.currentTime + 5);
    else if (b.dataset.sp) { workSpeed = +b.dataset.sp; a.playbackRate = workSpeed; a.preservesPitch = a.webkitPreservesPitch = true; }
    else if (b.classList.contains('sa')) { A = a.currentTime; if (B != null && B <= A) B = null; }
    else if (b.classList.contains('sb')) { const t = a.currentTime; if (A != null && t <= A) { toast('La fin (B) doit être après le début (A).'); return; } B = t; loop = true; if (A != null) a.currentTime = A; }
    else if (b.classList.contains('lp')) loop = !loop;
    else if (b.classList.contains('clr')) { A = B = null; }
    draw();
  });
  draw();
  // Fermer la fenêtre arrête la lecture
  const obs = new MutationObserver(() => { if (!sh.isConnected) { a.pause(); cancelAnimationFrame(raf); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
}

// ---------- Démarrage ----------
await migrateLocal();
await loadDocs();
render();
if (sb) {
  sb.auth.onAuthStateChange((ev, session) => {
    const was = user && user.id; user = session ? session.user : null;
    // Lien d'invitation ouvert sans être connecté : on explique et on ouvre la connexion
    if (!user && pref('pendingJoin', '') && !document.querySelector('.sheet')) {
      setTimeout(() => { cloudSheet(); toast('Pour rejoindre l\'équipe, crée ton compte (ou connecte-toi). L\'invitation s\'ouvrira ensuite.'); }, 400);
    }
    if ((user && user.id) === was) { syncUI(); return; }
    live();
    if (user) { loadTeams(true).then(() => { checkPendingJoin(); }); sync(true); }
    else { teams = []; members = []; space = ''; setPref('space', ''); refreshUI(true); }
    syncUI();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { syncSoon(100); loadTeams(); } });
  addEventListener('online', () => syncSoon(100)); addEventListener('offline', syncUI);
  setInterval(() => { if (!document.hidden) sync(); }, 60000);
} else checkPendingJoin();
syncUI();
})();
