# PerritoHábitos: mascota escolar con modelos locales

La interfaz adapta el diseño de `C:\RobotVoz\diseño web`, conservando sus
colores, mascota e imágenes. Funciona con el servidor Python existente;
no necesita Node, Gemini, fuentes externas ni un servicio de pago. El diseño
original permanece en su carpeta sin modificaciones.

## Guía de instalación y configuración

Esta guía está orientada a **Windows de 64 bits y PowerShell**. Los comandos
se ejecutan desde la carpeta `robot-voz-web`, donde están `app.py` y
`requirements.txt`. Copia la carpeta completa, incluyendo `assets`; no hace
falta copiar el proyecto original de diseño ni instalar Node.js.

La instalación y la descarga inicial necesitan Internet. Después, la
transcripción, el análisis y la voz se ejecutan localmente, sin claves API
ni servicios de pago. Tener los modelos guardados no instala sus dependencias
de Python: hacen falta ambas cosas.

### Si usas este equipo y ya está instalado

No necesitas reinstalar. Haz doble clic en `Iniciar.cmd` y abre
<http://localhost:8000>. Si ya hay un servidor abierto en ese puerto, usa
la página existente; no abras un segundo servidor en el mismo puerto.
Las rutas actuales se muestran en [Iniciar en este equipo](#iniciar-en-este-equipo).

### 1. Preparar Python y la carpeta del proyecto

La combinación comprobada utiliza **Python 3.11 de 64 bits**. Puedes obtener
el instalador de Windows en la [página oficial de Python 3.11.9](https://www.python.org/downloads/release/python-3119/).
Durante la instalación, incluye el lanzador de Python y marca **Add python.exe
to PATH**. Abre una nueva ventana de PowerShell después de instalar.

La referencia de hardware utilizada es un equipo con 16 GB de RAM y una GPU
NVIDIA de 4 GB. También se puede usar CPU, con mayor tiempo de respuesta.
Reserva aproximadamente 15 GB libres para el entorno, los modelos y las
descargas; es una estimación, no un requisito medido para todos los equipos.

Cambia la ruta del siguiente comando por la carpeta donde copiaste el proyecto:

```powershell
Set-Location 'C:\ruta\robot-voz-web'
py -3.11 --version
py -3.11 -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
```

No es necesario activar el entorno: los comandos llaman a su Python
directamente. Si `py` no existe, usa la ruta completa de tu Python 3.11:

```powershell
& 'C:\ruta\Python311\python.exe' -m venv .venv
```

### 2. Instalar PyTorch: elegir CPU o GPU

Ejecuta **una sola** de las dos opciones en el entorno recién creado.
Los comandos corresponden a [PyTorch 2.5.1](https://pytorch.org/get-started/previous-versions/),
la versión que utiliza este proyecto.

**Opción CPU**, si no tienes una GPU NVIDIA compatible:

```powershell
& .\.venv\Scripts\python.exe -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
```

**Opción GPU NVIDIA**, con un controlador compatible con CUDA 12.1:

```powershell
& .\.venv\Scripts\python.exe -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cu121
```

Qwen puede usar la GPU. Whisper y Piper utilizan CPU en esta aplicación.
No se necesitan `torchvision` ni `torchaudio` para este flujo.

### 3. Instalar las demás dependencias

```powershell
& .\.venv\Scripts\python.exe -m pip install numpy==1.26.4 huggingface-hub==0.36.2
& .\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
& .\.venv\Scripts\python.exe -m pip check
```

Se fijan NumPy y Hugging Face Hub a las versiones comprobadas en este equipo.
El archivo de requisitos incluye Transformers 4.46.3, SciPy 1.15.3 y
Piper 1.8.0. Conserva estas versiones al reproducir esta instalación.

Comprueba el entorno y si PyTorch detecta CUDA:

```powershell
& .\.venv\Scripts\python.exe -c "import torch, transformers, scipy, numpy, piper; print('PyTorch:', torch.__version__); print('CUDA disponible:', torch.cuda.is_available())"
```

`CUDA disponible: False` es normal para la instalación CPU. En una instalación
GPU, consulta [Solución de problemas](#solución-de-problemas) si aparece `False`.

### 4. Descargar Qwen y Whisper una sola vez

La aplicación necesita estos modelos exactos; `ROBOT_MODEL_CACHE` cambia la
ubicación de los archivos, no el modelo seleccionado:

| Función | Repositorio | Peso aproximado de los archivos del modelo |
| --- | --- | --- |
| Conversación | `Qwen/Qwen2.5-1.5B-Instruct` | 3 GB |
| Transcripción | `openai/whisper-small` | 1 GB |

Se usa la estructura de caché de Hugging Face, con carpetas `models--...`
y `snapshots`. Descargar los archivos sueltos a una carpeta cualquiera
no es equivalente. `openai/whisper-small` es el nombre del modelo local:
no significa que la aplicación llame a la API de OpenAI.

Este bloque crea un archivo auxiliar de descarga en la carpeta del proyecto.
Las revisiones corresponden a los archivos usados en este equipo. El filtro
descarga pesos Safetensors y archivos de configuración/tokenizador, evitando
copias adicionales de los pesos en otros formatos. Es el procedimiento de
[descarga selectiva de Hugging Face](https://huggingface.co/docs/huggingface_hub/en/guides/download).

```powershell
$env:HF_HUB_OFFLINE = '0'
$env:TRANSFORMERS_OFFLINE = '0'
@'
from pathlib import Path
from huggingface_hub import snapshot_download

cache = Path("models/hub").resolve()
models = [
    ("Qwen/Qwen2.5-1.5B-Instruct", "989aa7980e4cf806f80c7fef2b1adb7bc71aa306"),
    ("openai/whisper-small", "973afd24965f72e36ca33b3055d56a652f456b4d"),
]
for repo, revision in models:
    location = snapshot_download(
        repo_id=repo,
        revision=revision,
        cache_dir=str(cache),
        allow_patterns=["*.json", "*.txt", "model.safetensors"],
        token=False,
    )
    print(repo, "->", location)
'@ | Set-Content -Encoding UTF8 .\descargar-modelos.py
& .\.venv\Scripts\python.exe .\descargar-modelos.py
```

Espera a que termine sin errores. Si la descarga se interrumpe, repite el
último comando: se reutiliza lo que ya esté completo en la caché. No importes
`local_models` dentro del script de descarga; ese módulo activa el modo offline.

Si ya tienes ambos modelos en otra caché, puedes omitir esta descarga y
configurar su ruta en el paso 6. Para trasladarlos a otro equipo, copia
la caché completa, incluyendo `blobs` y `snapshots`, no solo sus enlaces.

### 5. Descargar la voz española de Piper

El [descargador oficial de Piper](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/CLI.md)
obtiene tanto el modelo de voz como su configuración:

```powershell
New-Item -ItemType Directory -Force -Path .\voices | Out-Null
& .\.venv\Scripts\python.exe -m piper.download_voices es_MX-ald-medium --download-dir .\voices
Get-Item .\voices\es_MX-ald-medium.onnx, .\voices\es_MX-ald-medium.onnx.json
```

La voz es español mexicano, de un solo hablante, y su modelo ocupa unos
63 MB. Ambos archivos deben permanecer juntos. También puedes copiar los
que ya tienes; el siguiente paso permite indicar su ubicación existente.

### 6. Configurar las rutas y hacer que funcione el doble clic

Desde la carpeta del proyecto, configura la sesión actual:

```powershell
$robotProjectPath = (Get-Location).Path
$env:ROBOT_PYTHON = Join-Path $robotProjectPath '.venv\Scripts\python.exe'
$env:ROBOT_MODEL_CACHE = Join-Path $robotProjectPath 'models\hub'
$env:ROBOT_VOICE_PATH = Join-Path $robotProjectPath 'voices\es_MX-ald-medium.onnx'
```

Si reutilizas otro entorno o archivos descargados antes, cambia esas tres
rutas por sus ubicaciones reales. `ROBOT_MODEL_CACHE` apunta a la carpeta
que contiene `models--Qwen--...` y `models--openai--...`; `ROBOT_VOICE_PATH`
apunta al **archivo** `.onnx`, no a la carpeta de voces.

Para conservar las rutas en nuevas terminales y al abrir `Iniciar.cmd`
desde el Explorador, guárdalas en las variables de tu usuario de Windows:

```powershell
[Environment]::SetEnvironmentVariable('ROBOT_PYTHON', $env:ROBOT_PYTHON, 'User')
[Environment]::SetEnvironmentVariable('ROBOT_MODEL_CACHE', $env:ROBOT_MODEL_CACHE, 'User')
[Environment]::SetEnvironmentVariable('ROBOT_VOICE_PATH', $env:ROBOT_VOICE_PATH, 'User')
```

Estas variables pertenecen a tu usuario y afectarán a futuras ejecuciones
del proyecto. Si mueves la carpeta, actualízalas. Para usarlas desde el
Explorador, cierra sesión y vuelve a entrar en Windows; mientras tanto
puedes arrancar desde esta PowerShell, que ya contiene las rutas correctas.

La aplicación nativa **no lee `.env` automáticamente**: ese archivo es
exclusivamente para Docker. No guardes claves API, porque no se utilizan.

### 7. Comprobar los archivos y arrancar

Este primer comando comprueba las rutas y dependencias sin descargar modelos
ni cargar sus pesos:

```powershell
& $env:ROBOT_PYTHON -c "import json; from local_models import LocalModels; print(json.dumps(LocalModels().status(), ensure_ascii=False, indent=2))"
```

Debe aparecer `"ready": true`, `"local": true` y `"missing": []`.
`loaded` puede estar vacío: los pesos se cargan en el primer uso.

Arranca en la misma terminal:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1 -OpenBrowser
```

Abre <http://localhost:8000> en Chrome o Edge. Mantén abierta la terminal del
servidor. Para detenerlo, pulsa **Ctrl+C** o cierra esa terminal.
El primer análisis y la primera transcripción tardan más porque cargan Qwen
y Whisper. Después de preparar todo, puedes utilizar la aplicación sin Internet.

Para comprobar un servidor que ya está iniciado, usa **otra** PowerShell:

```powershell
Invoke-RestMethod 'http://localhost:8000/api/status' | ConvertTo-Json -Depth 4
```

Para otro puerto, usa `-Port 8001` y abre `http://localhost:8001`.
El script fija el puerto de su argumento; no basta con cambiar `ROBOT_PORT`
antes de ejecutar `start-local.ps1`.

### 8. Configurar y probar la mascota

1. Abre **Mi perfil** y guarda tu nombre, rol, colegio y nombre de mascota.
2. En **Voz**, elige **Alegre**, pulsa **Probar voz** y después **Guardar voz**.
3. En **Configurar cómo responde la mascota**, guarda sus instrucciones y ejemplos.
4. Escribe «¿Cómo me llamo y cómo te llamas tú?» y pulsa **Analizar**.
5. Pulsa **Escuchar respuesta** para comprobar Piper.
6. Pulsa **Grabar audio**, permite el micrófono, habla y pulsa **Detener y transcribir**.
   Revisa el texto y pulsa **Analizar**; la transcripción no dispara el análisis sola.
7. Activa un recordatorio y pulsa **Probar**. Registra tus acciones reales en **Hábitos del día**.

Las instrucciones de uso, personalización y almacenamiento se detallan abajo.

### Variables de configuración

| Variable | Para qué sirve | Valor por defecto o comportamiento |
| --- | --- | --- |
| `ROBOT_PYTHON` | Python del entorno con las dependencias | El lanzador busca esta ruta, después `.venv\Scripts\python.exe` y después `C:\RobotVoz\.venv\Scripts\python.exe` |
| `ROBOT_MODEL_CACHE` | Caché con los snapshots de Qwen y Whisper | Si no se define, usa `HF_HUB_CACHE` o la caché del usuario en `.cache\huggingface\hub` |
| `ROBOT_VOICE_PATH` | Archivo de voz Piper `.onnx` | `C:\RobotVoz\es_MX-ald-medium.onnx`; necesita el `.onnx.json` junto a él |
| `ROBOT_DEVICE` | Dispositivo de Qwen | `cpu` fuerza CPU; si no se define, usa CUDA cuando está disponible |
| `ROBOT_CONFIG_FILE` | Archivo de instrucciones y ejemplos | `assistant_config.json` en la carpeta de la aplicación |
| `ROBOT_PORT` | Puerto al ejecutar `app.py` directamente | `8000`; con el lanzador utiliza `-Port` |
| `ROBOT_HOST` | Dirección al ejecutar `app.py` directamente | `127.0.0.1`; el lanzador también fija localhost |

Para forzar CPU durante una sesión:

```powershell
$env:ROBOT_DEVICE = 'cpu'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1
```

Para volver a la selección automática en esa sesión:

```powershell
Remove-Item Env:ROBOT_DEVICE -ErrorAction SilentlyContinue
```

### Solución de problemas

| Problema | Qué revisar |
| --- | --- |
| `py` no se reconoce o `python` abre Microsoft Store | Comprueba la instalación de Python 3.11 y usa su ruta completa para crear el entorno. Abre una nueva terminal después de instalar. |
| No se encuentra el Python con los modelos | Confirma que existe el archivo de `ROBOT_PYTHON`; en una instalación nueva debe ser el `.venv\Scripts\python.exe` del proyecto. |
| Falta una dependencia, como `piper` o `transformers` | Ejecuta la instalación de requisitos con el mismo Python usado para arrancar. Comprueba `pip check`. |
| No se encontraron archivos completos de Qwen o Whisper | Revisa `ROBOT_MODEL_CACHE`, la estructura `models--.../snapshots/...` y que haya `model.safetensors` y los JSON del tokenizador. Repite la descarga del paso 4 si quedó incompleta. |
| Fallan las descargas porque está activado el modo offline | Ejecuta el paso 4 en una PowerShell nueva con `HF_HUB_OFFLINE=0` y `TRANSFORMERS_OFFLINE=0`. La aplicación activa offline al arrancar, pero el descargador debe ejecutarse por separado. |
| Faltan los archivos de Piper | Comprueba que `ROBOT_VOICE_PATH` sea un `.onnx` existente y que también exista el mismo nombre con `.json` añadido. |
| `CUDA disponible: False` en un equipo NVIDIA | Revisa el controlador NVIDIA y que el entorno tenga el paquete `torch` de la opción `cu121`, no el de CPU. Puedes usar CPU mientras lo resuelves. |
| Error de memoria durante el análisis | Cierra aplicaciones que consuman memoria o inicia otra sesión del servidor con `ROBOT_DEVICE=cpu`. CPU necesita suficiente RAM y será más lenta. |
| Puerto ocupado / `WinError 10048` | Usa el servidor ya abierto, detenlo desde su terminal o inicia con `-Port 8001`. |
| No se puede conectar con el servidor | Mantén abierta la terminal del servidor, revisa sus mensajes y confirma el puerto. Abrir `index.html` directamente no arranca Python. |
| No graba el micrófono | Abre la página mediante `http://localhost:8000` en Chrome o Edge y permite el micrófono. También puedes escribir o subir un WAV PCM de 16 bits, máximo 30 segundos y 8 MB. |
| Hay respuesta escrita pero no sonido | Pulsa Escuchar, revisa el volumen de la ventana Voz y del sistema, y usa los controles del reproductor si el navegador bloquea reproducción automática. |
| Texto o contexto demasiado largo | Inicia Nueva conversación y reduce el texto, las instrucciones o los ejemplos. El contexto se limita a 2048 tokens de entrada. |
| No aparecen recordatorios | Actívalos y mantén la página abierta. Los horarios corresponden a Bogotá; el navegador cerrado no ejecuta recordatorios. |
| El perfil parece desaparecer | Usa el mismo navegador y la misma dirección/puerto. Un perfil privado, otra dirección o borrar datos del sitio tiene otro almacenamiento. |

### Copias de seguridad y traslado

Conserva la carpeta completa de la aplicación, `assistant_config.json`,
la caché de modelos y los dos archivos de Piper. El entorno `.venv` se
recrea en el otro equipo; no copies un entorno de Python esperando que sea portable.
Actualiza las variables de rutas después del traslado.

Perfil, cuidados, hábitos, recordatorios y voz están en el almacenamiento
del navegador, bajo la clave `robot_pet_local_v1`. **No se incluyen al copiar
la carpeta del proyecto.** Para conservarlos, puedes usar las herramientas
de desarrollador del navegador, pestaña **Application/Aplicación → Local
Storage → http://localhost:8000**, y copiar el valor de esa clave. Restáuralo
en la misma clave del navegador de destino y recarga la página. La aplicación
todavía no incluye botones de exportación o importación.

### Estructura que debes conservar

```text
robot-voz-web/
  app.py                   Servidor local y rutas HTTP
  local_models.py          Whisper, Qwen y Piper
  pet_context.py           Validación del perfil y contexto
  settings.py              Guardado de instrucciones
  assistant_config.json    Instrucciones y ejemplos
  index.html               Interfaz
  styles.css               Estilos
  app.js                   Grabación, análisis y reproducción
  pet.js                   Perfil, hábitos y recordatorios
  recorder-worklet.js      Captura local de audio
  assets/                  Imágenes de la interfaz
  requirements.txt         Dependencias de Python
  start-local.ps1          Lanzador Windows
  Iniciar.cmd              Inicio con doble clic
  .venv/                   Creado durante la instalación
  models/hub/              Creado por la descarga de Qwen/Whisper
  voices/                  Voz .onnx y .onnx.json
```

Las últimas tres carpetas se crean durante la instalación y pueden ubicarse
en otro directorio si configuras sus rutas.

## Perfil, cuidados, hábitos y recordatorios

- En **Mi perfil** configura tu nombre, rol (estudiante o docente), colegio,
  grado/asignatura y nombre de la mascota. Qwen recibe estos datos junto con
  los cuidados registrados al pulsar Analizar. Un ejemplo generado con los
  nombres actuales refuerza su identidad en cada solicitud y no altera los
  ejemplos guardados por el usuario.
- **Dar agua**, **Dar comida**, **Sacar a pasear** y **Acariciar** registran
  cuidados virtuales. Las barras representan el juego y disminuyen con el
  tiempo; no miden el estado de salud de una persona.
- En **Hábitos del día**, confirma tus propias acciones. Los contadores
  empiezan en cero cada día, según la fecha de Bogotá. Corregir resta una acción.
  Cuidar a la mascota no incrementa estos contadores.
- En **Recordatorios**, activa los sugeridos o crea uno por intervalo o
  por hora de Bogotá. **Probar** muestra el aviso, **Escuchar aviso** genera
  voz local y **Ya lo hice** registra el hábito de la persona. El aviso por
  intervalo se calcula desde su activación o último aviso; el horario avisa
  una vez por día y recupera el aviso al volver a una pestaña abierta si se
  cruzó la hora programada, incluso al pasar medianoche. Los avisos necesitan la página abierta;
  las pestañas en segundo plano pueden retrasarlos. No hay servicio en segundo
  plano con el navegador cerrado.
- En **Modo clase**, inicia o pausa el temporizador de estudio de 25 minutos
  o el descanso de 5 minutos. Completar un bloque no registra automáticamente
  un hábito ni cambia de modo sin tu elección.
- En **Voz**, ajusta la velocidad (0.7–1.4×) y volumen (0–100%) de Piper.
  El estilo **Alegre**, seleccionado inicialmente, sube el tono dos semitonos
  y anima ligeramente el ritmo; **Natural** conserva la voz original y
  **Tranquila** reduce el ritmo. **Probar voz** usa los ajustes de la ventana
  antes de guardarlos. Al guardar se aplican a las respuestas y los avisos.
  Los estilos son ajustes locales del audio y de la síntesis, no un modelo
  entrenado para interpretar emociones. La velocidad de Piper se compensa
  antes de elevar el tono para evitar acelerar demasiado el mensaje.
  Cambiar de timbre requiere instalar otro modelo de voz y configurar
  `ROBOT_VOICE_PATH`. La voz instalada tiene un solo hablante.

El perfil, cuidados, hábitos y recordatorios se guardan con `localStorage`
en este navegador, para una mascota por perfil de navegador. No hay cuentas
multiusuario ni sincronización entre equipos o navegadores. Editar el perfil
no crea otro registro de hábitos; en un equipo compartido usa perfiles de
navegador separados. Borrar los datos del sitio elimina estos registros.
Usa siempre la misma dirección (por ejemplo `http://localhost:8000`);
otro puerto o `127.0.0.1` utiliza un almacenamiento distinto.

Cambiar el perfil o registrar un cuidado reinicia el historial corto de
conversación para evitar recuerdos desactualizados. **Sin registrar** significa
que no hay información, no que la persona nunca realizó una acción.

Graba audio, revisa y corrige su transcripción, pulsa **Analizar** para obtener
una respuesta y, si quieres, pulsa **Escuchar respuesta**. También puedes
escribir el texto o cargar un WAV PCM de hasta 30 segundos.

Los modelos trabajan en este computador. La aplicación no usa la API de
OpenAI, no necesita claves ni envía el audio o las preguntas a servicios
externos. Se fuerza el modo sin conexión de Hugging Face y las cargas usan
`local_files_only=True`: si falta un modelo, la aplicación informa del problema
en lugar de descargarlo.

## Iniciar en este equipo

Haz doble clic en **Iniciar.cmd**. Abre `http://localhost:8000` en Chrome o
Edge. Mantén abierta la consola del servidor; para detenerlo pulsa Ctrl+C o
cierra esa consola.

También puedes iniciar sin abrir automáticamente el navegador:

```powershell
cd C:\Users\joshua\Downloads\robot\robot-voz-web
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1
```

Para otro puerto, añade `-Port 8001`. El script utiliza, en orden, el Python
definido en `ROBOT_PYTHON`, un entorno `.venv` dentro de esta carpeta o el
entorno existente `C:\RobotVoz\.venv`. No copia ni reinstala los modelos.

En este equipo se encontraron:

| Función | Modelo | Ubicación |
| --- | --- | --- |
| Transcripción | Whisper small | Caché local de Hugging Face |
| Análisis y respuesta | Qwen2.5-1.5B-Instruct | Caché local de Hugging Face |
| Voz | Piper, español mexicano | `C:\RobotVoz\es_MX-ald-medium.onnx` y su `.json` |

Qwen utiliza CUDA cuando está disponible; Whisper y Piper utilizan CPU. Esto
evita cargar ambos modelos en la GPU de 4 GB de este equipo. Los modelos se
cargan al usar cada función por primera vez; ese primer uso tarda más.

## Usar la página

1. Pulsa **Grabar audio**, permite el micrófono y habla. Pulsa
   **Detener y transcribir**; la grabación también se detiene a los 30 segundos.
2. Revisa el campo **Tu mensaje o transcripción**. Puedes corregirlo o reemplazarlo
   por un texto escrito. La transcripción no inicia el análisis automáticamente.
3. Pulsa **Analizar**. La respuesta aparecerá a la derecha. El texto de entrada
   se conserva para compararlo con la respuesta.
4. Pulsa **Escuchar respuesta** para generar la voz con Piper y reproducirla.
   La voz se genera solo cuando la solicitas.
5. **Nueva conversación** borra el texto, la respuesta, el audio y el historial
   de esta pestaña. No borra las instrucciones guardadas.

La página recuerda hasta tres turnos de conversación durante la sesión. No
guarda grabaciones ni conversaciones en el disco. Las instrucciones y los
ejemplos se guardan por separado en `assistant_config.json`.

## Configurar qué debe responder

Abre **Configurar cómo responde la mascota**. Escribe instrucciones que indiquen:

- **Quién es:** su función. Configura su nombre en Mi perfil para evitar nombres contradictorios.
- **Qué hace:** conversar, explicar o analizar lo que recibe.
- **Cómo responde:** idioma, tono y extensión.
- **Qué sabe:** hechos concretos que quieras proporcionarle.
- **Qué hace si no sabe:** reconocerlo o pedir más información.

Ejemplo para la mascota:

```text
Eres una mascota virtual educativa del colegio.
Responde siempre en español, con un tono amable y un máximo de dos frases.
Ayuda a comprender los temas con ejemplos sencillos.
No inventes datos del colegio.
Si falta información, pide una aclaración.
```

Ejemplo para analizar una transcripción:

```text
Analiza el texto recibido y responde en español.
Identifica la idea principal y contesta la pregunta planteada.
Si el texto describe un problema, sugiere un siguiente paso sencillo.
Usa solo la información proporcionada; pide aclaración si falta algo.
```

Añade hasta cinco pares de **Pregunta de ejemplo** y **Respuesta deseada**.
Por ejemplo:

| Pregunta | Respuesta deseada |
| --- | --- |
| ¿Quién eres? | Soy tu mascota virtual. Estoy aquí para acompañarte y aprender juntos. |
| ¿Puedes moverte? | Por ahora puedo conversar contigo. Mis movimientos todavía no están conectados. |

Pulsa **Guardar configuración**. Se reinicia el historial para que la próxima
respuesta use las nuevas instrucciones, conservando el texto que vas a
analizar. Los cambios sin guardar deben guardarse antes de analizar.
Usa **Probar pregunta** y luego **Analizar** para comprobar un ejemplo.
Si las instrucciones y los ejemplos ocupan demasiado contexto, la página
pedirá reducirlos antes de guardarlos; así queda espacio para el texto a analizar.

El límite de respuesta acepta entre 32 y 256 tokens. Un token es una parte de
una palabra: el límite no equivale a un número exacto de palabras. Puede
cortar una respuesta larga; para respuestas breves es mejor indicarlo también
en las instrucciones.

Esto configura el contexto enviado al modelo, no reentrena sus pesos. Los
ejemplos orientan su estilo y contenido; no garantizan una frase idéntica en
todas las variantes de una pregunta. Qwen es un modelo pequeño y puede
equivocarse: prueba las preguntas que realmente usarás. Si necesitas una
respuesta textual exacta, hace falta una regla explícita en la aplicación.

## Rutas y modelos en otro equipo

```powershell
$env:ROBOT_PYTHON = 'D:\RobotVoz\.venv\Scripts\python.exe'
$env:ROBOT_MODEL_CACHE = 'D:\Modelos\huggingface\hub'
$env:ROBOT_VOICE_PATH = 'D:\Voces\es_MX-ald-medium.onnx'
# Opcional: forzar Qwen a CPU (más lento y requiere más RAM).
$env:ROBOT_DEVICE = 'cpu'
```

La caché debe contener snapshots completos de `Qwen/Qwen2.5-1.5B-Instruct` y
`openai/whisper-small`. Piper necesita el `.onnx` y el `.onnx.json` juntos.
`requirements.txt` documenta las dependencias; este equipo ya tiene un entorno
con ellas. Preparar un equipo nuevo requiere instalar las dependencias y
descargar los modelos una vez, antes de trabajar sin conexión.

## Comprobaciones

Para la instalación nueva, desde la carpeta del proyecto:

```powershell
& .\.venv\Scripts\python.exe -B -m unittest discover -v
```

Para el entorno existente en este equipo:

```powershell
& C:\RobotVoz\.venv\Scripts\python.exe -B -m unittest discover -v
```

Las pruebas automáticas comprueban las rutas, el guardado de instrucciones,
la validación del audio y la preparación de mensajes sin cargar los pesos.
Las pruebas con modelos reales se realizan aparte en localhost.

## Docker opcional

La ejecución nativa anterior aprovecha la GPU instalada. La alternativa Docker
incluida utiliza CPU; no se ha ejecutado en este equipo y será más lenta.
Copia `.env.example` a `.env` y ajusta las rutas de los modelos y de la voz.
Si seguiste la instalación nueva, el contenido de `.env` será como este,
cambiando `C:/ruta` por la ubicación real:

```dotenv
ROBOT_MODEL_CACHE=C:/ruta/robot-voz-web/models/hub
ROBOT_VOICE_DIR=C:/ruta/robot-voz-web/voices
```

`ROBOT_VOICE_DIR` es una carpeta y debe contener `es_MX-ald-medium.onnx`
y `es_MX-ald-medium.onnx.json`, porque Compose utiliza ese nombre de voz.
Prepara los modelos con los pasos anteriores y detén el servidor nativo
si ocupa el puerto 8000. Desde la carpeta de la aplicación:

```powershell
docker compose up --build
```

Usa Docker Desktop con contenedores Linux. Para detenerlo, pulsa Ctrl+C
y ejecuta `docker compose down`; no añadas opciones para borrar datos.
La primera
construcción necesita Internet para instalar Python y sus dependencias; la
inferencia usa después los modelos montados en modo de solo lectura. En Docker,
la configuración se guarda en `local-data/assistant_config.json`.

Referencias: [Qwen](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct),
[Whisper](https://huggingface.co/openai/whisper-small),
[Transformers sin conexión](https://huggingface.co/docs/transformers/v4.46.3/installation#offline-mode).
