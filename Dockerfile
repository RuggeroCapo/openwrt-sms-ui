FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY static ./static
ENV DATA_DIR=/data PYTHONUNBUFFERED=1
EXPOSE 5000
CMD ["gunicorn", "-b", "0.0.0.0:5000", "-w", "1", "--threads", "4", "app:app"]
