FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt
COPY app.py local_models.py settings.py pet_context.py index.html app.js pet.js styles.css recorder-worklet.js ./
COPY assets/ ./assets/
ENV ROBOT_HOST=0.0.0.0 ROBOT_PORT=8000 PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
EXPOSE 8000
CMD ["python", "app.py"]
