"""Whisper, Qwen y Piper: inferencia con archivos locales, sin llamadas externas."""
import importlib.util
import io
import math
import os
import wave
from fractions import Fraction
from pathlib import Path
from threading import RLock

# Se establecen ANTES de importar Hugging Face. Además, cada carga exige archivos locales.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

QWEN_ID = "Qwen/Qwen2.5-1.5B-Instruct"
WHISPER_ID = "openai/whisper-small"
RATE = 16000
VOICE_STYLES = {"natural": (0, 1.0, None), "alegre": (2, 1.05, 0.72), "tranquila": (0, 0.94, 0.55)}


def shift_voice_pitch(samples, semitones):
    """Cambia ligeramente tono y duración; Piper compensa previamente la duración."""
    if not semitones or not len(samples):
        return samples
    import numpy as np
    from scipy.signal import resample_poly
    ratio = Fraction(2 ** (-semitones / 12)).limit_denominator(1000)
    shifted = resample_poly(samples, ratio.numerator, ratio.denominator).astype(np.float32)
    original_peak = float(np.max(np.abs(samples)))
    shifted_peak = float(np.max(np.abs(shifted)))
    if shifted_peak > original_peak:
        shifted *= original_peak / shifted_peak
    return shifted


class LocalModelError(RuntimeError):
    pass


def build_messages(question, history, config):
    messages = [{"role": "system", "content": config["instructions"]}]
    for example in config["examples"]:
        messages.extend([{"role": "user", "content": example["question"]},
                         {"role": "assistant", "content": example["answer"]}])
    messages.extend(history[-6:])
    messages.append({"role": "user", "content": question})
    return messages


def decode_wav(content):
    try:
        with wave.open(io.BytesIO(content), "rb") as reader:
            channels, width, rate, frames = (reader.getnchannels(), reader.getsampwidth(),
                                             reader.getframerate(), reader.getnframes())
            if width != 2 or channels not in (1, 2) or not 8000 <= rate <= 96000:
                raise ValueError("Usa audio WAV PCM de 16 bits, mono o estéreo.")
            if not 0 < frames / rate <= 30:
                raise ValueError("La grabación debe durar entre un instante y 30 segundos.")
            raw = reader.readframes(frames)
            if len(raw) != frames * width * channels:
                raise ValueError("El archivo de audio está incompleto.")
    except (wave.Error, EOFError) as exc:
        raise ValueError("El audio no es un archivo WAV válido.") from exc
    import numpy as np
    from scipy.signal import resample_poly
    audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
    if channels == 2:
        audio = audio.reshape(-1, 2).mean(axis=1)
    if rate != RATE:
        divisor = math.gcd(rate, RATE)
        audio = resample_poly(audio, RATE // divisor, rate // divisor)
    return audio.astype(np.float32)


class LocalModels:
    def __init__(self, cache_root=None, voice_path=None):
        default_cache = os.getenv("HF_HUB_CACHE") or str(Path.home() / ".cache/huggingface/hub")
        self.cache_root = Path(cache_root or os.getenv("ROBOT_MODEL_CACHE", default_cache)).expanduser()
        self.voice_path = Path(voice_path or os.getenv("ROBOT_VOICE_PATH", "C:/RobotVoz/es_MX-ald-medium.onnx"))
        self.lock = RLock()
        self.tokenizer = self.qwen = self.processor = self.whisper = self.voice = None
        self.device = None

    def snapshot(self, model_id):
        root = self.cache_root / ("models--" + model_id.replace("/", "--"))
        reference = root / "refs/main"
        candidates = []
        if reference.is_file():
            revision = reference.read_text(encoding="utf-8").strip()
            if len(revision) == 40 and all(c in "0123456789abcdef" for c in revision):
                candidates.append(root / "snapshots" / revision)
        candidates.extend(sorted((root / "snapshots").glob("*")))
        required = ["config.json", "model.safetensors", "tokenizer_config.json", "tokenizer.json"]
        if model_id == WHISPER_ID:
            required.append("preprocessor_config.json")
        for candidate in candidates:
            if all((candidate / name).is_file() for name in required):
                return candidate
        raise LocalModelError(f"No se encontraron los archivos completos de {model_id} en el equipo.")

    def status(self):
        missing = []
        for model in (QWEN_ID, WHISPER_ID):
            try:
                self.snapshot(model)
            except LocalModelError:
                missing.append(model)
        if not self.voice_path.is_file() or not Path(str(self.voice_path) + ".json").is_file():
            missing.append("Voz Piper (.onnx y .onnx.json)")
        for module in ("torch", "transformers", "numpy", "scipy", "piper"):
            if importlib.util.find_spec(module) is None:
                missing.append("Dependencia: " + module)
        loaded = [name for name, model in (("Qwen", self.qwen), ("Whisper", self.whisper),
                                          ("Piper", self.voice)) if model is not None]
        return {"ready": not missing, "local": True, "missing": missing, "loaded": loaded,
                "response_model": QWEN_ID, "transcription_model": WHISPER_ID,
                "voice": "Español mexicano · Piper", "device": self.device or "Sin cargar"}

    def load_tokenizer(self):
        if self.tokenizer is None:
            from transformers import AutoTokenizer
            self.tokenizer = AutoTokenizer.from_pretrained(self.snapshot(QWEN_ID), local_files_only=True)

    def check_prompt_size(self, config):
        with self.lock:
            self.load_tokenizer()
            prompt = self.tokenizer.apply_chat_template(build_messages("", [], config),
                                                        tokenize=False, add_generation_prompt=True)
            if len(self.tokenizer.encode(prompt, add_special_tokens=False)) > 1536:
                raise ValueError("Las instrucciones y los ejemplos son demasiado largos. "
                                 "Redúcelos para dejar espacio al texto que quieres analizar.")

    def load_qwen(self):
        if self.qwen is not None:
            return
        import torch
        from transformers import AutoModelForCausalLM
        location = self.snapshot(QWEN_ID)
        self.device = "cuda" if torch.cuda.is_available() and os.getenv("ROBOT_DEVICE") != "cpu" else "cpu"
        torch.set_num_threads(min(8, os.cpu_count() or 4))
        dtype = torch.float16 if self.device == "cuda" else torch.float32
        print(f"Cargando Qwen local en {self.device}...", flush=True)
        self.load_tokenizer()
        model = AutoModelForCausalLM.from_pretrained(location, torch_dtype=dtype,
                                                    local_files_only=True).to(self.device).eval()
        self.qwen = model
        print("Qwen listo.", flush=True)

    def chat(self, question, history, config):
        with self.lock:
            self.load_qwen()
            import torch
            messages = build_messages(question, history, config)
            prompt = self.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
            inputs = self.tokenizer(prompt, return_tensors="pt", add_special_tokens=False).to(self.device)
            length = inputs.input_ids.shape[1]
            if length > 2048:
                raise ValueError("El texto, el historial y los ejemplos son demasiado largos. "
                                 "Inicia una nueva conversación o reduce el texto y los ejemplos.")
            with torch.inference_mode():
                output = self.qwen.generate(**inputs, max_new_tokens=config["max_new_tokens"],
                                            do_sample=False, temperature=1.0, top_p=1.0, top_k=50,
                                            pad_token_id=self.tokenizer.eos_token_id)
            generated = output[0, length:]
            reply = self.tokenizer.decode(generated, skip_special_tokens=True).strip()
            if not reply:
                raise LocalModelError("El modelo no produjo texto. Prueba con otra pregunta.")
            return {"reply": reply, "input_tokens": length, "output_tokens": len(generated)}

    def transcribe(self, content):
        audio = decode_wav(content)
        import numpy as np
        if float(np.sqrt(np.mean(audio * audio))) < 0.0001:
            return ""
        with self.lock:
            import torch
            from transformers import WhisperForConditionalGeneration, WhisperProcessor
            torch.set_num_threads(min(8, os.cpu_count() or 4))
            if self.whisper is None:
                location = self.snapshot(WHISPER_ID)
                print("Cargando Whisper local en CPU...", flush=True)
                processor = WhisperProcessor.from_pretrained(location, local_files_only=True)
                model = WhisperForConditionalGeneration.from_pretrained(
                    location, local_files_only=True, torch_dtype=torch.float32).eval()
                model.generation_config.forced_decoder_ids = None
                model.config.forced_decoder_ids = None
                self.processor, self.whisper = processor, model
                print("Whisper listo.", flush=True)
            features = self.processor(audio, sampling_rate=RATE, return_tensors="pt", return_attention_mask=True)
            with torch.inference_mode():
                output = self.whisper.generate(features.input_features, attention_mask=features.attention_mask,
                                               language="spanish",
                                               task="transcribe", max_new_tokens=192, do_sample=False)
            return self.processor.batch_decode(output, skip_special_tokens=True)[0].strip()

    def speech(self, text, speed=1.0, volume=1.0, style="natural"):
        with self.lock:
            from piper import PiperVoice
            from piper.config import SynthesisConfig
            if self.voice is None:
                if not self.voice_path.is_file() or not Path(str(self.voice_path) + ".json").is_file():
                    raise LocalModelError("Faltan los archivos de la voz Piper.")
                self.voice = PiperVoice.load(self.voice_path, use_cuda=False)
            buffer = io.BytesIO()
            semitones, pace, noise = VOICE_STYLES[style]
            pitch_factor = 2 ** (semitones / 12)
            synthesis = SynthesisConfig(length_scale=pitch_factor / (speed * pace),
                                        noise_scale=noise, volume=volume)
            with wave.open(buffer, "wb") as writer:
                if not semitones:
                    self.voice.synthesize_wav(text, writer, syn_config=synthesis)
                else:
                    import numpy as np
                    writer.setframerate(self.voice.config.sample_rate)
                    writer.setsampwidth(2)
                    writer.setnchannels(1)
                    for chunk in self.voice.synthesize(text, syn_config=synthesis):
                        audio = shift_voice_pitch(chunk.audio_float_array, semitones)
                        writer.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
            return buffer.getvalue()
