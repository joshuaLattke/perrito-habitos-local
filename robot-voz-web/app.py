"""Web local para transcribir, analizar con Qwen y escuchar con Piper."""
import json
import os
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from local_models import LocalModels, LocalModelError
from settings import clean_text, load_config, save_config, validate_config
from pet_context import context_instructions, voice_value

HERE = Path(__file__).resolve().parent
CONFIG_PATH = Path(os.getenv("ROBOT_CONFIG_FILE", str(HERE / "assistant_config.json")))
models = LocalModels()


class Handler(BaseHTTPRequestHandler):
    def result(self, status, data, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def json_result(self, status, obj):
        self.result(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                    "application/json; charset=utf-8")

    def local_request(self):
        hosts = {f"localhost:{self.server.server_port}", f"127.0.0.1:{self.server.server_port}"}
        if self.headers.get("Host", "") not in hosts:
            self.json_result(403, {"error": "Usa localhost para acceder al servidor."})
            return False
        origin = self.headers.get("Origin")
        if origin and origin not in {"http://" + host for host in hosts}:
            self.json_result(403, {"error": "Origen no autorizado."})
            return False
        return True

    def body(self, maximum=8_000_000):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Longitud de solicitud inválida.") from exc
        if not 0 < length <= maximum:
            raise ValueError("Solicitud vacía o demasiado grande.")
        return self.rfile.read(length)

    def json_body(self):
        data = json.loads(self.body(40_000))
        if not isinstance(data, dict):
            raise ValueError("La solicitud debe ser un objeto JSON.")
        return data

    def do_GET(self):
        if not self.local_request():
            return
        try:
            files = {"/": ("index.html", "text/html; charset=utf-8"),
                     "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                     "/pet.js": ("pet.js", "text/javascript; charset=utf-8"),
                     "/styles.css": ("styles.css", "text/css; charset=utf-8"),
                     "/recorder-worklet.js": ("recorder-worklet.js", "text/javascript; charset=utf-8")}
            for image in (HERE / "assets").glob("*.jpg"):
                files["/assets/" + image.name] = ("assets/" + image.name, "image/jpeg")
            if self.path in files:
                filename, mime = files[self.path]
                self.result(200, (HERE / filename).read_bytes(), mime)
            elif self.path == "/api/status":
                self.json_result(200, models.status())
            elif self.path == "/api/config":
                self.json_result(200, load_config(CONFIG_PATH))
            elif self.path == "/favicon.ico":
                self.result(204, b"", "image/x-icon")
            else:
                self.json_result(404, {"error": "Ruta no encontrada."})
        except (ValueError, OSError):
            self.json_result(500, {"error": "No se pudo leer la página o la configuración local."})

    def do_POST(self):
        if not self.local_request():
            return
        try:
            if self.path == "/api/config":
                config = validate_config(self.json_body())
                models.check_prompt_size(config)
                self.json_result(200, save_config(CONFIG_PATH, config))
            elif self.path == "/api/chat":
                self.chat()
            elif self.path == "/api/transcribe":
                self.transcribe()
            elif self.path == "/api/speech":
                self.speech()
            else:
                self.json_result(404, {"error": "Ruta no encontrada."})
        except (ValueError, UnicodeDecodeError) as exc:
            self.json_result(400, {"error": str(exc)})
        except (LocalModelError, ImportError) as exc:
            self.json_result(503, {"error": str(exc) + " Revisa los modelos y el Python del proyecto."})
        except Exception:
            traceback.print_exc()
            self.json_result(500, {"error": "No se pudo ejecutar el modelo local. "
                                 "Revisa el registro del servidor; puede faltar memoria disponible."})

    def chat(self):
        data = self.json_body()
        question = clean_text(data.get("question"), "Transcripción o pregunta", 6000)
        history = data.get("history", [])
        if not isinstance(history, list):
            raise ValueError("Historial inválido.")
        messages = []
        for entry in history[-6:]:
            if (not isinstance(entry, dict) or entry.get("role") not in ("user", "assistant")
                    or not isinstance(entry.get("content"), str)):
                raise ValueError("Historial inválido.")
            messages.append({"role": entry["role"], "content": entry["content"][:1000]})
        start = time.perf_counter()
        config = load_config(CONFIG_PATH)
        context = data.get("context")
        config["instructions"] += context_instructions(context)
        if context and context.get("user_name", "").strip() and context.get("pet_name", "").strip():
            config["examples"].append({
                "question": "¿Cómo me llamo y cómo te llamas tú?",
                "answer": f"Tú te llamas {context['user_name'].strip()} y yo soy "
                          f"{context['pet_name'].strip()}, tu mascota virtual.",
            })
        result = models.chat(question, messages, config)
        self.json_result(200, dict(result, seconds=round(time.perf_counter() - start, 2)))

    def transcribe(self):
        if self.headers.get("Content-Type", "").split(";", 1)[0].lower() != "audio/wav":
            raise ValueError("Usa la grabación WAV de esta página o un archivo WAV PCM.")
        audio = self.body()
        start = time.perf_counter()
        text = models.transcribe(audio)
        self.json_result(200, {"text": text, "seconds": round(time.perf_counter() - start, 2)})

    def speech(self):
        data = self.json_body()
        text = clean_text(data.get("text"), "Respuesta", 2000)
        speed = voice_value(data.get("speed", 1.0), "Velocidad", 0.7, 1.4)
        volume = voice_value(data.get("volume", 1.0), "Volumen", 0.0, 1.0)
        style = data.get("style", "natural")
        if not isinstance(style, str) or style not in ("natural", "alegre", "tranquila"):
            raise ValueError("Elige un estilo de voz: natural, alegre o tranquila.")
        self.result(200, models.speech(text, speed=speed, volume=volume, style=style), "audio/wav")


def main():
    host = os.getenv("ROBOT_HOST", "127.0.0.1")
    port = int(os.getenv("ROBOT_PORT", "8000"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Abre http://localhost:{port} | Whisper + Qwen + Piper, ejecución local.", flush=True)
    print("Los modelos se cargan al usarlos por primera vez. No se necesita clave API.", flush=True)
    if os.getenv("ROBOT_OPEN_BROWSER") == "1":
        import webbrowser
        webbrowser.open(f"http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Servidor detenido.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
