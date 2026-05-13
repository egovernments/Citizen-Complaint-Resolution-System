# Jupyter Lab with CRS DataLoader
FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /home/jovyan/work

# Copy requirements first for caching
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Create jovyan user (standard Jupyter user)
RUN useradd -m -s /bin/bash jovyan && \
    chown -R jovyan:jovyan /home/jovyan

# Copy dataloader files
COPY --chown=jovyan:jovyan dataloader/ /home/jovyan/work/

# Create templates directory (will be mounted)
RUN mkdir -p /home/jovyan/work/templates && \
    chown -R jovyan:jovyan /home/jovyan/work/templates

# Switch to jovyan user
USER jovyan

# Expose Jupyter port
EXPOSE 8888

# Set environment variables for DIGIT connection
ENV DIGIT_URL=http://kong:8000
ENV DIGIT_INTERNAL_URL=http://host.docker.internal
ENV JUPYTER_ENABLE_LAB=yes

# Start Jupyter Lab
CMD ["jupyter", "lab", "--ip=0.0.0.0", "--port=8888", "--no-browser", "--NotebookApp.token=''", "--NotebookApp.password=''"]
