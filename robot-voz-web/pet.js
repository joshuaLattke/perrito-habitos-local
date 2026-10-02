'use strict';
// Adaptación del diseño PerritoHábitos: registros locales y voz Piper.
(() => {
  const el = id => document.getElementById(id);
  const storageKey = 'robot_pet_local_v1';
  const bogota = date => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  const today = () => bogota(new Date());
  const emptyHabits = () => ({date: today(), water: 0, food: 0, walk: 0, stretch: 0});
  const defaultState = () => ({
    profile: {name: '', role: 'student', group: '', school: '', petName: 'Milo'},
    care: {water: null, food: null, walk: null, pet: null}, createdAt: Date.now(),
    habits: emptyHabits(), voice: {speed: 1, volume: 1, style: 'alegre'},
    reminders: [
      {id: 'water', title: 'Mi pausa para beber agua', category: 'water', frequency: 'interval', minutes: 45, time: '10:30', enabled: false, lastTriggered: Date.now()},
      {id: 'walk', title: 'Moverme y descansar un momento', category: 'walk', frequency: 'interval', minutes: 60, time: '10:30', enabled: false, lastTriggered: Date.now()},
      {id: 'food', title: 'Hora de mi merienda', category: 'food', frequency: 'time', minutes: 60, time: '10:30', enabled: false, lastTriggered: Date.now()},
    ],
  });
  const categories = ['water', 'food', 'walk', 'stretch', 'custom'];
  const boundedText = (value, fallback = '') => typeof value === 'string' ? value.slice(0, 100) : fallback;
  const validTime = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Date.now() ? value : null;
  let state = defaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved === 'object') {
      for (const key of ['name', 'group', 'school', 'petName']) state.profile[key] = boundedText(saved.profile?.[key], state.profile[key]);
      state.profile.petName ||= 'Milo';
      state.profile.role = saved.profile?.role === 'teacher' ? 'teacher' : 'student';
      for (const key of ['water', 'food', 'walk', 'pet']) state.care[key] = validTime(saved.care?.[key]);
      state.createdAt = validTime(saved.createdAt) || Date.now();
      if (saved.habits?.date === today()) {
        for (const key of ['water', 'food', 'walk', 'stretch']) {
          const count = saved.habits[key];
          state.habits[key] = Number.isInteger(count) && count >= 0 && count <= 100 ? count : 0;
        }
      }
      if (typeof saved.voice?.speed === 'number' && saved.voice.speed >= .7 && saved.voice.speed <= 1.4) state.voice.speed = saved.voice.speed;
      if (typeof saved.voice?.volume === 'number' && saved.voice.volume >= 0 && saved.voice.volume <= 1) state.voice.volume = saved.voice.volume;
      if (['natural', 'alegre', 'tranquila'].includes(saved.voice?.style)) state.voice.style = saved.voice.style;
      if (Array.isArray(saved.reminders)) state.reminders = saved.reminders.slice(0, 20).filter(r => r && typeof r.id === 'string' && categories.includes(r.category)).map(r => ({
        id: r.id.slice(0, 100), title: boundedText(r.title, 'Recordatorio'), category: r.category,
        frequency: r.frequency === 'time' ? 'time' : 'interval', minutes: Number.isInteger(r.minutes) && r.minutes >= 1 && r.minutes <= 1440 ? r.minutes : 45,
        time: /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : '10:30', enabled: r.enabled === true,
        lastTriggered: validTime(r.lastTriggered) || Date.now(), lastDay: boundedText(r.lastDay),
      }));
    }
  } catch { /* Un registro incompleto no impide usar la mascota. */ }
  let toastTimer, working = false, currentAlert = null, alertQueue = [];
  let lastReminderCheck = Date.now();
  let timerMode = 'focus', remaining = 25 * 60, timerDeadline = null;
  const node = (tag, text, className) => {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  };
  function toast(message) {
    clearTimeout(toastTimer); el('pet-toast').textContent = message; el('pet-toast').hidden = false;
    toastTimer = setTimeout(() => { el('pet-toast').hidden = true; }, 4500);
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); }
    catch { toast('El navegador no permitió guardar. Tus cambios durarán mientras la página esté abierta.'); }
  }
  function changed() { window.dispatchEvent(new Event('pet-context-changed')); }
  function say(message) { el('pet-message').textContent = message; }
  function relativeTime(timestamp) {
    if (!timestamp) return 'Sin registrar';
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    return minutes < 1 ? 'Hace un momento' : minutes < 60 ? `Hace ${minutes} minutos` : `Hace ${Math.floor(minutes / 60)} horas`;
  }
  function renewDay() {
    if (state.habits.date !== today()) { state.habits = emptyHabits(); persist(); changed(); renderHabits(); }
  }
  function getContext() {
    renewDay();
    return {user_name: state.profile.name, pet_name: state.profile.petName, role: state.profile.role,
      school: state.profile.school, group: state.profile.group,
      care: {water: relativeTime(state.care.water), food: relativeTime(state.care.food), walk: relativeTime(state.care.walk)},
      habits: {water: state.habits.water, food: state.habits.food, walk: state.habits.walk, stretch: state.habits.stretch}};
  }
  function renderProfile() {
    const p = state.profile;
    el('profile-button').textContent = p.name || 'Mi perfil'; el('pet-title').textContent = p.petName;
    el('speech-label').textContent = `${p.petName} ${p.name ? 'dice a ' + p.name : 'dice'}:`;
    el('greeting').textContent = p.name ? `¡Hola, ${p.name}!` : '¡Bienvenido a tu compañero escolar!';
    el('profile-summary').textContent = [p.role === 'teacher' ? 'Docente' : 'Estudiante', p.group, p.school].filter(Boolean).join(' · ');
    el('pet-avatar').setAttribute('aria-label', 'Acariciar a ' + p.petName);
  }
  function renderMeters() {
    const settings = [['water', 'Agua', '#0284c7', 180], ['food', 'Comida', '#d97706', 240], ['walk', 'Paseo', '#0d9370', 180], ['pet', 'Ánimo', '#e65d85', 300]];
    const items = settings.map(([key, label, color, decay]) => {
      const elapsed = Math.max(0, Date.now() - (state.care[key] || state.createdAt)) / 60000;
      const value = Math.max(5, Math.round(100 - elapsed * 100 / decay));
      const item = node('div', undefined, 'meter'), heading = node('div', undefined, 'meter-heading');
      heading.append(node('span', label), node('span', value + '%'));
      const track = node('div', undefined, 'meter-track'), fill = node('div', undefined, 'meter-fill');
      fill.style.width = value + '%'; fill.style.backgroundColor = color; track.append(fill);
      item.append(heading, track, node('div', relativeTime(state.care[key]), 'meter-note'));
      return item;
    });
    el('pet-meters').replaceChildren(...items);
  }
  function care(key) {
    if (working) return;
    state.care[key] = Date.now(); persist(); renderMeters(); changed();
    const messages = {water: '¡Gracias por darme agua! Si te apetece, podemos hacer una pausa para hidratarnos.',
      food: '¡Gracias por mi comida! Cuando sea tu hora de comer, recuerda hacer una pausa tranquila.',
      walk: '¡Qué alegría pasear contigo! También puedes levantarte y moverte cuando tu clase lo permita.',
      pet: '¡Guau! Gracias por el cariño. Me alegra acompañarte.'};
    say(messages[key]); toast(`${state.profile.petName}: cuidado registrado`);
  }
  const habitInfo = [
    ['water', 'Agua', 'Vasos de agua que has confirmado hoy.', 'Ya bebí agua', 'habit_hydration_school_1790950797829.jpg'],
    ['walk', 'Movimiento', 'Pausas activas que has realizado hoy.', 'Ya hice una pausa', 'habit_active_walk_1790950810360.jpg'],
    ['food', 'Mi alimentación', 'Pausas para comer que has registrado hoy.', 'Ya comí', null],
    ['stretch', 'Un momento de descanso', 'Estiramientos o descansos que has confirmado.', 'Ya descansé', null],
  ];
  function updateHabit(key, change) {
    if (working) return;
    renewDay(); state.habits[key] = Math.max(0, Math.min(100, state.habits[key] + change));
    persist(); renderHabits(); changed();
    if (change > 0) toast('¡Bien! Tu hábito quedó registrado.');
  }
  function renderHabits() {
    el('habits-date').textContent = new Intl.DateTimeFormat('es-CO', {timeZone: 'America/Bogota', day: 'numeric', month: 'long'}).format(new Date());
    el('habits-grid').replaceChildren(...habitInfo.map(([key, title, description, action, image]) => {
      const item = node('article', undefined, 'habit-card');
      if (image) { const img = node('img'); img.src = '/assets/' + image; img.alt = title; item.append(img); }
      const body = node('div', undefined, 'habit-body'), count = node('div', state.habits[key], 'habit-count');
      count.id = 'habit-count-' + key;
      const buttons = node('div', undefined, 'buttons'), add = node('button', action), undo = node('button', '− Corregir', 'quiet');
      add.dataset.habit = key; add.disabled = working || state.habits[key] >= 100; add.onclick = () => updateHabit(key, 1);
      undo.dataset.habit = key; undo.disabled = working || !state.habits[key]; undo.onclick = () => updateHabit(key, -1);
      buttons.append(add, undo); body.append(node('h3', title), node('p', description), count, buttons); item.append(body); return item;
    }));
  }
  function selectTab(tab) {
    document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== tab; });
    document.querySelectorAll('[data-tab]').forEach(button => {
      if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    renewDay();
  }
  function renderReminders() {
    const list = state.reminders.map(reminder => {
      const item = node('div', undefined, 'reminder-row'), info = node('div');
      info.append(node('strong', reminder.title), node('p', reminder.frequency === 'interval' ? `Cada ${reminder.minutes} minutos` : `${reminder.time} · Hora de Bogotá`));
      const buttons = node('div', undefined, 'buttons');
      const test = node('button', 'Probar', 'quiet'); test.onclick = () => enqueueAlert(reminder);
      const toggle = node('button', reminder.enabled ? 'Activo' : 'Activar', 'secondary'); toggle.setAttribute('aria-pressed', String(reminder.enabled));
      toggle.onclick = () => {
        reminder.enabled = !reminder.enabled; reminder.lastTriggered = Date.now();
        if (!reminder.enabled) alertQueue = alertQueue.filter(r => r.id !== reminder.id);
        persist(); renderReminders();
      };
      const remove = node('button', 'Eliminar', 'quiet'); remove.onclick = () => {
        state.reminders = state.reminders.filter(r => r.id !== reminder.id); alertQueue = alertQueue.filter(r => r.id !== reminder.id); persist(); renderReminders();
      };
      buttons.append(test, toggle, remove); item.append(info, buttons); return item;
    });
    el('reminder-list').replaceChildren(...(list.length ? list : [node('p', 'Añade tu primer recordatorio.', 'muted')]));
  }
  function enqueueAlert(reminder) {
    if (currentAlert?.id === reminder.id || alertQueue.some(r => r.id === reminder.id)) return;
    if (alertQueue.length < 20) alertQueue.push({...reminder});
    showNextAlert();
  }
  function showNextAlert() {
    if (working || currentAlert || !alertQueue.length || document.querySelector('dialog[open]')) return;
    currentAlert = alertQueue.shift();
    const name = state.profile.name || 'compañero';
    el('alert-title').textContent = currentAlert.title;
    el('alert-message').textContent = `¡Hola, ${name}! Soy ${state.profile.petName}. Es momento de: ${currentAlert.title.toLowerCase()}. Cuando lo hagas, puedes registrarlo aquí.`;
    el('alert-error').textContent = ''; el('alert-complete').textContent = categories.includes(currentAlert.category) && currentAlert.category !== 'custom' ? 'Ya lo hice · registrar hábito' : 'Listo';
    el('reminder-dialog').showModal();
  }
  function checkReminders() {
    renewDay(); renderMeters();
    const now = Date.now(), day = today();
    const time = new Intl.DateTimeFormat('en-GB', {timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(now));
    let touched = false;
    for (const r of state.reminders) {
      if (!r.enabled) continue;
      let scheduled = new Date(`${day}T${r.time}:00-05:00`).getTime();
      if (scheduled > now) scheduled -= 24 * 60 * 60 * 1000;
      const scheduledDay = bogota(new Date(scheduled));
      const crossedTime = scheduled > lastReminderCheck && scheduled <= now;
      const due = r.frequency === 'interval' ? now - r.lastTriggered >= r.minutes * 60000 : (time === r.time || crossedTime) && r.lastDay !== scheduledDay;
      if (due) { r.lastTriggered = now; r.lastDay = scheduledDay; touched = true; enqueueAlert(r); }
    }
    if (touched) persist();
    lastReminderCheck = now;
    showNextAlert();
  }
  function dismissAlert() { el('reminder-dialog').close(); }
  function showVoiceOutputs() {
    el('speed-output').textContent = Number(el('voice-speed').value).toFixed(2) + '×';
    el('volume-output').textContent = Math.round(Number(el('voice-volume').value) * 100) + '%';
  }
  function openDialog(id) {
    if (working) return;
    if (id === 'profile-dialog') {
      for (const [field, key] of [['name', 'name'], ['role', 'role'], ['group', 'group'], ['school', 'school'], ['pet', 'petName']]) el('profile-' + field).value = state.profile[key];
    } else {
      el('voice-speed').value = state.voice.speed; el('voice-volume').value = state.voice.volume; el('voice-style').value = state.voice.style; showVoiceOutputs();
    }
    el(id).showModal();
  }
  function setWorking(value) {
    working = value;
    document.querySelectorAll('[data-care],[data-open],#pet-avatar,#alert-complete,#alert-listen,#alert-dismiss,#voice-preview,#voice-save').forEach(button => { button.disabled = value; });
    el('voice-preview').textContent = value ? 'Generando audio…' : 'Probar voz';
    renderHabits();
    if (!value) showNextAlert();
  }
  function renderTimer() {
    if (timerDeadline !== null) {
      remaining = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
      if (remaining === 0) {
        timerDeadline = null;
        const message = timerMode === 'focus' ? '¡Terminaste tu bloque de estudio! Puedes hacer una pausa.' : 'Terminó el descanso. Puedes volver a tus tareas.';
        el('timer-status').textContent = message; say(message); toast(message);
      }
    }
    el('timer-clock').textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
    el('timer-start').textContent = timerDeadline !== null ? 'Pausar' : remaining ? 'Comenzar' : 'Volver a empezar';
  }
  document.querySelectorAll('[data-tab]').forEach(button => { button.onclick = () => selectTab(button.dataset.tab); });
  document.querySelectorAll('[data-open]').forEach(button => { button.onclick = () => openDialog(button.dataset.open); });
  document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => el(button.dataset.close).close(); });
  document.querySelectorAll('[data-care]').forEach(button => { button.onclick = () => care(button.dataset.care); });
  el('pet-avatar').onclick = () => care('pet');
  el('profile-form').onsubmit = event => {
    event.preventDefault(); if (working) return;
    state.profile = {name: el('profile-name').value.trim(), role: el('profile-role').value,
      group: el('profile-group').value.trim(), school: el('profile-school').value.trim(), petName: el('profile-pet').value.trim()};
    if (!state.profile.name || !state.profile.petName) { toast('Escribe tu nombre y el de tu mascota.'); return; }
    persist(); renderProfile(); changed();
    say(`¡Hola, ${state.profile.name}! Soy ${state.profile.petName}. Estoy aquí para acompañarte y recordar nuestros pequeños hábitos.`);
    el('profile-dialog').close(); toast('Perfil guardado en este navegador.');
  };
  el('voice-speed').oninput = showVoiceOutputs; el('voice-volume').oninput = showVoiceOutputs;
  el('voice-form').onsubmit = event => {
    event.preventDefault(); if (working) return;
    state.voice = {speed: Number(el('voice-speed').value), volume: Number(el('voice-volume').value), style: el('voice-style').value};
    persist(); el('voice-dialog').close(); toast('Voz guardada. Se aplicará al próximo audio.');
  };
  el('voice-preview').onclick = () => {
    if (working) return;
    const name = state.profile.name ? ', ' + state.profile.name : '';
    window.dispatchEvent(new CustomEvent('pet-speech-request', {detail: {
      text: `¡Hola${name}! Soy ${state.profile.petName}. ¡Guau! ¿Vamos a aprender y jugar juntos? Hagamos una pequeña pausa para beber agua.`,
      voice: {speed: Number(el('voice-speed').value), volume: Number(el('voice-volume').value), style: el('voice-style').value},
    }}));
  };
  el('reminder-frequency').onchange = () => {
    const interval = el('reminder-frequency').value === 'interval'; el('interval-field').hidden = !interval; el('time-field').hidden = interval;
    el('reminder-minutes').disabled = !interval; el('reminder-time').disabled = interval;
  };
  el('reminder-form').onsubmit = event => {
    event.preventDefault();
    if (state.reminders.length >= 20) { toast('Puedes guardar hasta 20 recordatorios.'); return; }
    const interval = el('reminder-frequency').value === 'interval';
    const title = el('reminder-title').value.trim(), minutes = interval ? Number(el('reminder-minutes').value) : 45, time = interval ? '10:30' : el('reminder-time').value;
    if (!title || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return;
    state.reminders.push({id: crypto.randomUUID(), title, category: el('reminder-category').value,
      frequency: el('reminder-frequency').value, minutes, time, enabled: true, lastTriggered: Date.now()});
    persist(); renderReminders(); el('reminder-form').reset(); el('reminder-frequency').onchange(); toast('Recordatorio activado.');
  };
  el('alert-dismiss').onclick = dismissAlert;
  el('alert-complete').onclick = () => {
    if (working || !currentAlert) return;
    if (currentAlert.category !== 'custom') updateHabit(currentAlert.category, 1);
    dismissAlert();
  };
  el('alert-listen').onclick = () => window.dispatchEvent(new CustomEvent('pet-speech-request', {detail: {text: el('alert-message').textContent}}));
  el('reminder-dialog').addEventListener('close', () => { currentAlert = null; setTimeout(showNextAlert, 100); });
  el('reminder-dialog').addEventListener('cancel', event => { if (working) event.preventDefault(); });
  ['profile-dialog', 'voice-dialog'].forEach(id => el(id).addEventListener('close', () => setTimeout(showNextAlert, 100)));
  document.querySelectorAll('[data-timer-mode]').forEach(button => { button.onclick = () => {
    timerMode = button.dataset.timerMode; timerDeadline = null; remaining = timerMode === 'focus' ? 25 * 60 : 5 * 60;
    document.querySelectorAll('[data-timer-mode]').forEach(b => { b.className = b === button ? 'secondary' : 'quiet'; });
    el('timer-status').textContent = timerMode === 'focus' ? 'Tiempo para estudiar' : 'Tiempo para descansar'; renderTimer();
  }; });
  el('timer-start').onclick = () => {
    if (timerDeadline !== null) { remaining = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000)); timerDeadline = null; el('timer-status').textContent = 'En pausa'; }
    else { if (!remaining) remaining = timerMode === 'focus' ? 25 * 60 : 5 * 60; timerDeadline = Date.now() + remaining * 1000; el('timer-status').textContent = timerMode === 'focus' ? 'Estudiando con tu mascota' : 'Disfruta tu descanso'; }
    renderTimer();
  };
  el('timer-reset').onclick = () => { timerDeadline = null; remaining = timerMode === 'focus' ? 25 * 60 : 5 * 60; el('timer-status').textContent = 'Listo para empezar'; renderTimer(); };
  window.addEventListener('focus', checkReminders); document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReminders(); });
  for (const id of ['player', 'alert-player', 'voice-preview-player']) {
    el(id).addEventListener('play', () => el('pet-avatar').classList.add('speaking'));
    for (const event of ['pause', 'ended', 'error']) el(id).addEventListener(event, () => el('pet-avatar').classList.remove('speaking'));
  }
  window.PetApp = {getContext, voiceSettings: () => ({...state.voice}), say, setWorking};
  renderProfile(); renderMeters(); renderHabits(); renderReminders();
  el('reminder-frequency').onchange();
  if (state.profile.name) say(`¡Hola, ${state.profile.name}! Soy ${state.profile.petName}. ¿Cómo va tu día?`);
  setInterval(checkReminders, 10000); setInterval(renderTimer, 1000);
})();
