# Router SMS per Umbrel OS

App Flask che legge e invia SMS dal modem di un router (OpenWrt + ModemManager) via SSH.

## Installazione manuale su Umbrel

    ssh umbrel@umbrel.local
    cd ~/umbrel/app-data
    git clone <URL_REPO> router-sms
    # aggiornare: cd router-sms && git pull

Poi installa/avvia l'app (`umbrel-app.yml` ha `id: router-sms`, cartella e id devono coincidere).
Al primo avvio inserisci i dati del router nella schermata di configurazione; vengono salvati
in `data/config.json` (ignorato da git). Dopo un `git pull` ricostruisci con
`docker compose build` nella cartella dell'app e riavvia l'app.

## Sviluppo

    python -m venv venv && venv/bin/pip install -r requirements.txt
    venv/bin/python app.py   # http://127.0.0.1:5000
