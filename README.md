# PerritoHábitos · Mascota escolar local

La aplicación está en la carpeta **robot-voz-web**. Usa Whisper para
transcribir, Qwen para conversar y Piper para generar voz en el computador.

La [guía completa de instalación y configuración](robot-voz-web/README.md)
incluye:

- Instalación desde cero en Windows con Python 3.11, CPU o GPU NVIDIA.
- Descarga de los modelos y la voz, y configuración de sus rutas.
- Inicio con `Iniciar.cmd` y acceso a `http://localhost:8000`.
- Perfil, mascota, hábitos, recordatorios y estilos de voz.
- Instrucciones y ejemplos de respuesta para el modelo local.
- Solución de problemas, copias de seguridad y Docker opcional.

En el equipo ya configurado, abre `robot-voz-web\Iniciar.cmd`.
Si el servidor ya está activo, visita <http://localhost:8000>.

La preparación inicial requiere Internet. La inferencia funciona localmente
y no necesita claves API ni servicios de pago.
