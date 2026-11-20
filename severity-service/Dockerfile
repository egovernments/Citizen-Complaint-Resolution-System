FROM python:3.11-slim

WORKDIR /srv
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

COPY requirements.txt .
# CPU-only torch keeps the image small; sentence-transformers needs torch.
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu torch \
 && pip install -r requirements.txt

# The predictor loads the encoder by its Hugging Face name (model/label_map.json,
# "embedding_model"), not from a path. Download it once here into the HF cache and
# bake that cache into the image; HF_HUB_OFFLINE=1 is set only AFTER the download so
# the running container never reaches the network.
ENV HF_HOME=/srv/hf-cache
COPY model/label_map.json /tmp/label_map.json
RUN python -c "import json; from sentence_transformers import SentenceTransformer as S; S(json.load(open('/tmp/label_map.json'))['embedding_model'])" \
 && rm /tmp/label_map.json
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1

COPY app ./app
COPY model ./model

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD python -c "import urllib.request as u; u.urlopen('http://localhost:8000/health')" || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
