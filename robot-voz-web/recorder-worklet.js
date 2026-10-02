// Captura muestras PCM del micrófono. No usa reconocimiento de voz del navegador.
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const channels = inputs[0];
    if (channels && channels.length && channels[0].length) {
      const mono = new Float32Array(channels[0].length);
      for (const channel of channels) {
        for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
      }
      this.port.postMessage(mono, [mono.buffer]);
    }
    for (const output of outputs) for (const channel of output) channel.fill(0);
    return true;
  }
}
registerProcessor('robot-recorder', RecorderProcessor);
