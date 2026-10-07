# Router SMS per Umbrel OS

App Flask che legge e invia SMS dal modem di un router (OpenWrt + ModemManager) via SSH.

## Installazione manuale su Umbrel (standalone)

    ssh umbrel@umbrel.local
    git clone <URL_REPO> ~/umbrel/home/router-sms && cd ~/umbrel/home/router-sms
    sudo docker compose up -d --build

Apri `http://umbrel.local:5080` e inserisci i dati del router (salvati in `data/config.json`,
ignorato da git). Aggiornare: `git pull && sudo docker compose up -d --build`.

Attenzione: in questa modalita' non c'e' il login di Umbrel, chiunque sia sulla tua LAN
puo' aprire l'app. `docker-compose.umbrel.yml` e `umbrel-app.yml` servono solo per
un'installazione come vera app Umbrel (con app proxy).

## Sviluppo

    python -m venv venv && venv/bin/pip install -r requirements.txt
    venv/bin/python app.py   # http://127.0.0.1:5000
