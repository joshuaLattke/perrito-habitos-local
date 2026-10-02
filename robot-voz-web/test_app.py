"""Pruebas HTTP sin cargar los modelos ni acceder a Internet."""
import http.client
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import app


class FakeModels:
    def check_prompt_size(self, config):
        pass

    def status(self):
        return {"ready": True, "local": True, "missing": [], "loaded": []}

    def chat(self, question, history, config):
        return {"reply": config["instructions"] + ": " + question,
                "input_tokens": 20, "output_tokens": 8}

    def transcribe(self, audio):
        return "Hola, mascota."

    def speech(self, text, speed=1.0, volume=1.0, style="natural"):
        return b"RIFF" + f"{speed}:{volume}:{style}:".encode() + text.encode()


class AppTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.config_file = Path(self.directory.name) / "assistant_config.json"
        self.addCleanup(patch.stopall)
        patch.object(app, "CONFIG_PATH", self.config_file, create=True).start()
        patch.object(app, "models", FakeModels(), create=True).start()

    def request(self, method, path, data=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        body = json.dumps(data).encode() if data is not None else None
        connection.request(method, path, body, headers or {"Content-Type": "application/json"})
        response = connection.getresponse()
        raw = response.read()
        connection.close()
        return response.status, raw

    def test_status_reports_local_models_without_an_api_key(self):
        with patch.dict("os.environ", {"OPENAI_API_KEY": ""}):
            status, raw = self.request("GET", "/api/status")
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(raw).get("local"))
        self.assertTrue(json.loads(raw)["ready"])

    def test_saved_instructions_are_used_for_analysis(self):
        settings = {"instructions": "Responde como una mascota educativa",
                    "examples": [{"question": "¿Quién eres?", "answer": "Soy Milo."}],
                    "max_new_tokens": 96}
        status, raw = self.request("POST", "/api/config", settings)
        self.assertEqual(status, 200, raw)
        self.assertEqual(json.loads(self.config_file.read_text(encoding="utf-8")), settings)
        status, raw = self.request("POST", "/api/chat", {"question": "  Hola  ", "history": []})
        self.assertEqual(status, 200, raw)
        self.assertEqual(json.loads(raw)["reply"], "Responde como una mascota educativa: Hola")

    def test_invalid_settings_do_not_overwrite_saved_settings(self):
        settings = {"instructions": "Responde en español", "examples": [], "max_new_tokens": 96}
        self.assertEqual(self.request("POST", "/api/config", settings)[0], 200)
        for bad_value in (0, True, 300, "muchos"):
            with self.subTest(value=bad_value):
                status, _ = self.request("POST", "/api/config", dict(settings, max_new_tokens=bad_value))
                self.assertEqual(status, 400)
        status, raw = self.request("GET", "/api/config")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw), settings)

    def test_other_websites_cannot_change_configuration(self):
        status, _ = self.request("POST", "/api/config", {},
                                 {"Content-Type": "application/json", "Origin": "https://example.com"})
        self.assertEqual(status, 403)
        self.assertFalse(self.config_file.exists())

    def test_context_rejection_keeps_existing_configuration(self):
        settings = {"instructions": "Responde en español", "examples": [], "max_new_tokens": 96}
        self.assertEqual(self.request("POST", "/api/config", settings)[0], 200)
        with patch.object(FakeModels, "check_prompt_size", side_effect=ValueError("Contexto demasiado largo")):
            status, _ = self.request("POST", "/api/config", dict(settings, instructions="Otro texto"))
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(self.config_file.read_text(encoding="utf-8")), settings)

    def test_non_object_json_and_empty_questions_are_rejected(self):
        for payload in ([], None, {"question": " "}, {"question": "Hola", "history": {}}):
            with self.subTest(payload=payload):
                status, _ = self.request("POST", "/api/chat", payload)
                self.assertEqual(status, 400)

    def test_speech_is_local_wav(self):
        status, raw = self.request("POST", "/api/speech", {"text": "Hola"})
        self.assertEqual(status, 200, raw)
        self.assertTrue(raw.startswith(b"RIFF"))

    def test_pet_context_personalizes_analysis_without_changing_saved_instructions(self):
        context = {"user_name": "Ana", "pet_name": "Kip", "role": "student",
                   "school": "Mi colegio", "group": "Quinto",
                   "care": {"water": "Sin registrar", "food": "Hace 5 minutos", "walk": "Sin registrar"},
                   "habits": {"water": 0, "food": 1, "walk": 0, "stretch": 0}}
        before = json.loads(self.request("GET", "/api/config")[1])
        status, raw = self.request("POST", "/api/chat", {"question": "¿Cómo me llamo?", "context": context})
        self.assertEqual(status, 200, raw)
        reply = json.loads(raw)["reply"]
        self.assertIn('Ana', reply)
        self.assertIn('Kip', reply)
        self.assertIn('Sin registrar', reply)
        self.assertEqual(json.loads(self.request("GET", "/api/config")[1]), before)

    def test_bad_context_and_voice_values_are_rejected(self):
        for context in ("inventado", {"user_name": "a" * 1000}, {"habits": {"water": -1}}):
            self.assertEqual(self.request("POST", "/api/chat", {"question": "Hola", "context": context})[0], 400)
        for value in (True, "rápido", 0, 20):
            self.assertEqual(self.request("POST", "/api/speech", {"text": "Hola", "speed": value})[0], 400)

    def test_piper_receives_selected_voice_speed_and_volume(self):
        status, raw = self.request("POST", "/api/speech", {"text": "Hola", "speed": 0.85, "volume": 0.5})
        self.assertEqual(status, 200, raw)
        self.assertIn(b"0.85:0.5:", raw)

    def test_cheerful_voice_style_is_used_and_unknown_styles_are_rejected(self):
        status, raw = self.request("POST", "/api/speech", {"text": "Hola", "style": "alegre"})
        self.assertEqual(status, 200, raw)
        self.assertIn(b":alegre:", raw)
        for style in ("externa", [], None):
            self.assertEqual(self.request("POST", "/api/speech", {"text": "Hola", "style": style})[0], 400)


if __name__ == "__main__":
    unittest.main()
