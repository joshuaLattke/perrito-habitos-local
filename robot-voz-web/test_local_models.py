import importlib
import importlib.util
import io
import struct
import tempfile
import unittest
import wave
from pathlib import Path


class LocalModelsTest(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec("local_models"), "Falta el motor local")
        self.local = importlib.import_module("local_models")

    def test_examples_and_instructions_precede_the_current_question(self):
        config = {"instructions": "Eres Milo.", "examples": [
            {"question": "¿Quién eres?", "answer": "Soy Milo."}], "max_new_tokens": 96}
        messages = self.local.build_messages("¿Qué haces?", [], config)
        self.assertEqual(messages, [
            {"role": "system", "content": "Eres Milo."},
            {"role": "user", "content": "¿Quién eres?"},
            {"role": "assistant", "content": "Soy Milo."},
            {"role": "user", "content": "¿Qué haces?"}])

    def test_stereo_wav_is_resampled_for_whisper(self):
        output = io.BytesIO()
        with wave.open(output, "wb") as writer:
            writer.setnchannels(2)
            writer.setsampwidth(2)
            writer.setframerate(48000)
            writer.writeframes(struct.pack("<hh", 12000, 12000) * 4800)
        samples = self.local.decode_wav(output.getvalue())
        self.assertEqual(len(samples), 1600)
        self.assertAlmostEqual(float(samples[800]), 12000 / 32768, places=3)

    def test_invalid_or_oversized_audio_is_rejected_before_loading_models(self):
        for content in (b"not wav", b""):
            with self.subTest(content=content):
                with self.assertRaises(ValueError):
                    self.local.decode_wav(content)
        output = io.BytesIO()
        with wave.open(output, "wb") as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(16000)
            writer.writeframes(b"\0\0" * (16000 * 31))
        with self.assertRaises(ValueError):
            self.local.decode_wav(output.getvalue())

    def test_missing_models_are_reported_without_downloading_anything(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = self.local.LocalModels(cache_root=Path(directory),
                                            voice_path=Path(directory) / "voice.onnx")
            result = engine.status()
        self.assertFalse(result["ready"])
        self.assertTrue(result["local"])
        self.assertGreaterEqual(len(result["missing"]), 3)

    def test_oversized_configuration_is_rejected_before_model_inference(self):
        class Tokenizer:
            def apply_chat_template(self, *args, **kwargs):
                return "prompt"

            def encode(self, *args, **kwargs):
                return [42] * 1800

        engine = self.local.LocalModels()
        engine.tokenizer = Tokenizer()
        with self.assertRaises(ValueError):
            engine.check_prompt_size({"instructions": "Instrucciones", "examples": [], "max_new_tokens": 96})
        self.assertIsNone(engine.qwen)

    def test_cheerful_pitch_raises_frequency_and_preserves_volume(self):
        import numpy as np
        tone = (0.4 * np.sin(2 * np.pi * 220 * np.arange(22050) / 22050)).astype(np.float32)
        self.assertTrue(hasattr(self.local, "shift_voice_pitch"), "Falta ajustar el tono localmente")
        shifted = self.local.shift_voice_pitch(tone, 2)
        spectrum = np.abs(np.fft.rfft(shifted))
        peak = np.fft.rfftfreq(len(shifted), 1 / 22050)[np.argmax(spectrum)]
        self.assertAlmostEqual(peak, 220 * 2 ** (2 / 12), delta=2)
        self.assertLessEqual(float(np.max(np.abs(shifted))), 0.401)
        self.assertTrue(np.all(self.local.shift_voice_pitch(np.zeros(100, dtype=np.float32), 2) == 0))


if __name__ == "__main__":
    unittest.main()
