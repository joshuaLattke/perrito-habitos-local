"""Instrucciones y ejemplos persistentes, independientes de los modelos."""
import copy
import json
import os
import tempfile
from pathlib import Path
from threading import RLock

DEFAULT_CONFIG = {
    "instructions": (
        "Eres una mascota virtual educativa para estudiantes y profesores. "
        "Responde siempre en español, con un tono amable y frases sencillas. "
        "Responde a la pregunta o analiza el texto recibido en una o dos frases. "
        "Si no sabes algo, dilo; si falta información, pide una aclaración. "
        "No inventes datos del colegio ni afirmes realizar movimientos físicos. "
        "Si un niño describe una situación delicada, sugiere hablar con un adulto de confianza."
    ),
    "examples": [
        {"question": "¿Quién eres?", "answer": "Soy tu mascota virtual. Estoy aquí para acompañarte y aprender juntos."},
        {"question": "¿Puedes moverte?", "answer": "Por ahora puedo conversar contigo. Mis movimientos todavía no están conectados."},
    ],
    "max_new_tokens": 128,
}
LOCK = RLock()


def clean_text(value, name, maximum):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name}: escribe un texto.")
    if len(value.strip()) > maximum:
        raise ValueError(f"{name}: máximo {maximum} caracteres.")
    return value.strip()


def validate_config(data):
    if not isinstance(data, dict):
        raise ValueError("Configuración inválida.")
    instructions = clean_text(data.get("instructions"), "Instrucciones", 3000)
    tokens = data.get("max_new_tokens", 128)
    if type(tokens) is not int or not 32 <= tokens <= 256:
        raise ValueError("La longitud de respuesta debe estar entre 32 y 256 tokens.")
    examples = data.get("examples", [])
    if not isinstance(examples, list) or len(examples) > 5:
        raise ValueError("Puedes guardar hasta cinco ejemplos.")
    result = []
    for example in examples:
        if not isinstance(example, dict):
            raise ValueError("Ejemplo inválido.")
        result.append({"question": clean_text(example.get("question"), "Pregunta del ejemplo", 300),
                       "answer": clean_text(example.get("answer"), "Respuesta del ejemplo", 600)})
    return {"instructions": instructions, "examples": result, "max_new_tokens": tokens}


def load_config(path):
    with LOCK:
        if not path.exists():
            return copy.deepcopy(DEFAULT_CONFIG)
        return validate_config(json.loads(path.read_text(encoding="utf-8")))


def save_config(path, data):
    data = validate_config(data)
    with LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                             suffix=".tmp", delete=False) as output:
                temporary = Path(output.name)
                json.dump(data, output, ensure_ascii=False, indent=2)
                output.write("\n")
            os.replace(temporary, path)
        finally:
            if temporary and temporary.exists():
                temporary.unlink()
    return data
