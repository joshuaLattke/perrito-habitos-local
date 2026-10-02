'use strict';
const $ = selector => document.querySelector(selector);
const history = [];
let busy = true, available = false, configReady = false, dirty = false;
let recording = null, lastAnswer = '', audioUrl = null, exampleId = 0;

function showError(message = '') { $('#error').textContent = message; }
function showStatus(message = '') { $('#status').textContent = message; }
function controls() {
  const working = busy || Boolean(recording);
  $('#mic').disabled = busy || !available;
  $('#mic').textContent = recording ? 'Detener y transcribir' : 'Grabar audio';
  $('#mic').classList.toggle('recording', Boolean(recording));
  $('#analyze').disabled = working || !available || dirty || !configReady || !$('#transcript').value.trim();
  $('#listen').disabled = working || !lastAnswer || !available;
  $('#clear').disabled = working;
  $('#transcript').disabled = working;
  $('#audio-file').disabled = working || !available;
  $('#config-fields').disabled = working || !configReady;
  $('#save-config').disabled = working || !configReady || !dirty;
  $('#add-example').disabled = working || !configReady || $('#examples').children.length >= 5;
  $('#response-card').setAttribute('aria-busy', String(busy));
  window.PetApp?.setWorking(working);
  $('#voice-preview').disabled = working || !available;
}
function setBusy(value, message = '') { busy = value; showStatus(message); controls(); }
function discardAudio() {
  for (const selector of ['#player', '#alert-player', '#voice-preview-player']) {
    const player = $(selector);
    player.pause(); player.removeAttribute('src'); player.load(); player.hidden = true;
  }
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null;
}
function resetResponse() {
  lastAnswer = ''; discardAudio();
  $('#response').textContent = 'La respuesta aparecerá aquí cuando pulses Analizar.';
  $('#response').classList.add('placeholder');
}
async function request(path, options = {}, timeout = 240000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {...options, signal: controller.signal});
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo completar la operación.');
    }
    return response;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('El modelo está tardando demasiado. Revisa el registro del servidor antes de repetir.');
    if (error instanceof TypeError) throw new Error('No se pudo conectar con el servidor local.');
    throw error;
  } finally { clearTimeout(timer); }
}
const post = (path, data) => request(path, {
  method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data),
});
async function refreshModels() {
  const data = await (await request('/api/status', {}, 10000)).json();
  available = data.ready;
  $('#ready').textContent = available ? 'Modelos locales disponibles' : 'Revisa la instalación local';
  $('#ready').classList.toggle('warning', !available);
  $('#model-detail').textContent = available
    ? `Respuesta: Qwen · Transcripción: Whisper · Voz: Piper${data.loaded.length ? ' · Cargados: ' + data.loaded.join(', ') : ''}`
    : 'Falta: ' + data.missing.join(', ');
  controls();
}
async function analyze() {
  const question = $('#transcript').value.trim();
  if (!question || busy || recording || dirty || !available || !configReady) return;
  showError(); resetResponse();
  setBusy(true, 'Analizando en tu equipo. La primera respuesta puede tardar mientras carga el modelo.');
  try {
    const data = await (await post('/api/chat', {question, history, context: window.PetApp?.getContext()})).json();
    lastAnswer = data.reply;
    $('#response').textContent = data.reply;
    $('#response').classList.remove('placeholder');
    window.PetApp?.say(data.reply);
    history.push({role: 'user', content: question}, {role: 'assistant', content: data.reply});
    if (history.length > 6) history.splice(0, history.length - 6);
    $('#analysis-time').textContent = data.seconds + ' s';
    $('#tokens').textContent = data.input_tokens + data.output_tokens;
    showStatus('Respuesta lista. Puedes leerla o pulsar Escuchar respuesta.');
  } catch (error) { showError(error.message); showStatus(''); }
  finally { busy = false; controls(); refreshModels().catch(() => {}); }
}
async function listen(text = lastAnswer, voice = null) {
  if (typeof text !== 'string') text = lastAnswer;
  if (!text || busy || recording || !available) return;
  const inReminder = $('#reminder-dialog').open;
  const inPreview = $('#voice-dialog').open;
  const player = inPreview ? $('#voice-preview-player') : inReminder ? $('#alert-player') : $('#player');
  $('#alert-error').textContent = '';
  $('#voice-preview-error').textContent = '';
  showError(); discardAudio(); setBusy(true, 'Generando la voz en tu equipo…');
  try {
    const response = await post('/api/speech', {text, ...(voice || window.PetApp?.voiceSettings())});
    audioUrl = URL.createObjectURL(await response.blob());
    if (inPreview && !$('#voice-dialog').open) { discardAudio(); return; }
    player.src = audioUrl; player.hidden = false;
    try { await player.play(); showStatus('Reproduciendo la respuesta.'); }
    catch { showStatus('Audio listo. Pulsa reproducir para escucharlo.'); }
  } catch (error) {
    showError(error.message); showStatus('');
    if (inReminder) $('#alert-error').textContent = error.message;
    if (inPreview) $('#voice-preview-error').textContent = error.message;
  }
  finally { busy = false; controls(); }
}
$('#reminder-dialog').addEventListener('close', discardAudio);
$('#voice-dialog').addEventListener('close', discardAudio);
window.addEventListener('pet-speech-request', event => {
  if (busy || recording) return;
  showError();
  listen(event.detail.text, event.detail.voice);
});
window.addEventListener('pet-context-changed', () => {
  history.length = 0; resetResponse(); controls();
});
function encodeWav(chunks, sampleRate) {
  const count = Math.min(chunks.reduce((sum, chunk) => sum + chunk.length, 0), sampleRate * 30);
  if (!count) throw new Error('No se recibió audio del micrófono.');
  const buffer = new ArrayBuffer(44 + count * 2), view = new DataView(buffer);
  const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, count * 2, true);
  let index = 0;
  for (const chunk of chunks) for (const value of chunk) {
    if (index >= count) break;
    const sample = Math.max(-1, Math.min(1, value));
    view.setInt16(44 + index++ * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([buffer], {type: 'audio/wav'});
}
async function transcribe(blob) {
  showError(); setBusy(true, 'Transcribiendo en tu equipo. La primera grabación puede tardar mientras carga Whisper.');
  try {
    if (!blob.size || blob.size > 8000000) throw new Error('Usa un WAV de hasta 30 segundos y 8 MB.');
    const response = await request('/api/transcribe', {method: 'POST', headers: {'Content-Type': 'audio/wav'}, body: blob});
    const data = await response.json();
    if (!data.text.trim()) {
      showError('No se detectó voz. Tu texto anterior se conserva; prueba de nuevo.'); showStatus('');
    } else {
      $('#transcript').value = data.text;
      $('#transcription-time').textContent = data.seconds + ' s';
      showStatus('Transcripción lista. Corrígela si hace falta y pulsa Analizar.');
    }
  } catch (error) { showError(error.message); showStatus(''); }
  finally { busy = false; controls(); refreshModels().catch(() => {}); }
}
async function stopRecording() {
  const session = recording;
  if (!session) return;
  recording = null; busy = true; clearTimeout(session.timer); controls();
  try {
    session.node.disconnect(); session.source.disconnect();
    session.stream.getTracks().forEach(track => track.stop());
    await session.context.close();
    const blob = encodeWav(session.chunks, session.sampleRate);
    await transcribe(blob);
  } catch (error) { showError(error.message); setBusy(false); }
}
async function startRecording() {
  if (recording) return stopRecording();
  if (busy || !available) return;
  let stream = null, context = null;
  showError(); discardAudio(); setBusy(true, 'Esperando permiso para usar el micrófono…');
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error('Abre localhost en Chrome o Edge para grabar.');
    stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true}});
    context = new AudioContext({sampleRate: 16000});
    await context.audioWorklet.addModule('/recorder-worklet.js');
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'robot-recorder');
    const chunks = [];
    node.port.onmessage = event => chunks.push(event.data);
    source.connect(node); node.connect(context.destination);
    recording = {stream, context, source, node, chunks, sampleRate: context.sampleRate,
                 timer: setTimeout(stopRecording, 30000)};
    busy = false; showStatus('Grabando… Pulsa Detener y transcribir. Máximo 30 segundos.'); controls();
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    if (context) await context.close().catch(() => {});
    showError(error.name === 'NotAllowedError' ? 'Permite el acceso al micrófono en el navegador.' : error.message);
    setBusy(false);
  }
}
function markDirty() {
  dirty = true; $('#config-status').textContent = 'Cambios sin guardar. Guarda antes de analizar.'; controls();
}
function addExample(question = '', answer = '') {
  if ($('#examples').children.length >= 5) return;
  const number = ++exampleId, row = document.createElement('div'); row.className = 'example';
  const questionLabel = document.createElement('label'); questionLabel.htmlFor = 'example-q-' + number; questionLabel.textContent = 'Pregunta de ejemplo';
  const input = document.createElement('input'); input.id = questionLabel.htmlFor; input.className = 'example-question'; input.maxLength = 300; input.value = question; input.required = true;
  const answerLabel = document.createElement('label'); answerLabel.htmlFor = 'example-a-' + number; answerLabel.textContent = 'Respuesta deseada';
  const textarea = document.createElement('textarea'); textarea.id = answerLabel.htmlFor; textarea.className = 'example-answer'; textarea.maxLength = 600; textarea.value = answer; textarea.required = true; textarea.rows = 2;
  const buttons = document.createElement('div'); buttons.className = 'buttons';
  const use = document.createElement('button'); use.type = 'button'; use.className = 'secondary'; use.textContent = 'Probar pregunta';
  use.onclick = () => { $('#transcript').value = input.value; controls(); $('#transcript').focus(); };
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'quiet'; remove.textContent = 'Eliminar ejemplo';
  remove.onclick = () => { row.remove(); markDirty(); };
  buttons.append(use, remove); row.append(questionLabel, input, answerLabel, textarea, buttons); $('#examples').append(row);
}
async function saveConfig(event) {
  event.preventDefault();
  if (busy || recording || !configReady) return;
  const config = {
    instructions: $('#instructions').value,
    max_new_tokens: Number($('#max-tokens').value),
    examples: [...$('#examples').children].map(row => ({question: row.querySelector('.example-question').value, answer: row.querySelector('.example-answer').value})),
  };
  showError(); setBusy(true, 'Guardando las instrucciones…');
  try {
    await post('/api/config', config); dirty = false; history.length = 0; resetResponse();
    $('#config-status').textContent = 'Configuración guardada en este equipo. Se usará en el próximo análisis.';
    showStatus('Configuración aplicada. Se ha reiniciado el historial para usar las nuevas instrucciones.');
  } catch (error) { showError(error.message); showStatus(''); }
  finally { busy = false; controls(); }
}
$('#mic').onclick = startRecording;
$('#analyze').onclick = analyze;
$('#listen').onclick = listen;
$('#transcript').addEventListener('input', controls);
$('#audio-file').onchange = async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (file && !busy && !recording && available) await transcribe(file);
};
$('#clear').onclick = () => {
  if (busy || recording) return;
  history.length = 0; $('#transcript').value = ''; resetResponse(); showError(); showStatus();
  $('#analysis-time').textContent = '—'; $('#transcription-time').textContent = '—'; $('#tokens').textContent = '—'; controls();
};
$('#config-form').onsubmit = saveConfig;
$('#config-form').addEventListener('input', markDirty);
$('#add-example').onclick = () => { addExample(); markDirty(); };
window.addEventListener('pagehide', () => {
  if (recording) { clearTimeout(recording.timer); recording.stream.getTracks().forEach(track => track.stop()); recording.context.close(); }
  if (audioUrl) URL.revokeObjectURL(audioUrl);
});
async function init() {
  controls();
  try {
    const [config] = await Promise.all([
      request('/api/config', {}, 10000).then(response => response.json()), refreshModels(),
    ]);
    $('#instructions').value = config.instructions; $('#max-tokens').value = config.max_new_tokens;
    for (const example of config.examples) addExample(example.question, example.answer);
    configReady = true; dirty = false;
    $('#config-status').textContent = 'Las instrucciones y los ejemplos se aplican a cada análisis.';
  } catch (error) { showError(error.message); $('#ready').textContent = 'Revisa el servidor local'; }
  finally { busy = false; controls(); }
}
init();
