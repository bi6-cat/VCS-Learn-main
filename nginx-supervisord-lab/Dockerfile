FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       nginx openssl python3 supervisor \
    && rm -rf /var/lib/apt/lists/*

COPY nginx.conf /etc/nginx/nginx.conf
COPY supervisord.conf /etc/supervisor/supervisord.conf
COPY app.py /opt/lab/app.py
COPY extra_app.py /opt/lab/extra_app.py
COPY index.html /var/www/lab/index.html
COPY downloads/ /var/www/lab/downloads/

RUN mkdir -p /etc/nginx/ssl /etc/supervisor/conf.d /var/log/nginx /var/log/supervisor \
    && openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
       -keyout /etc/nginx/ssl/lab.key \
       -out /etc/nginx/ssl/lab.crt \
       -subj "/CN=localhost" \
       -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

EXPOSE 80 443

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
