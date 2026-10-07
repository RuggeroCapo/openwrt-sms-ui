import hashlib
import json
import os
import re
import shlex
import threading
import time

import paramiko
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

load_dotenv()

DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
CONFIG_PATH = os.path.join(DATA_DIR, "config.json")
CACHE_TTL = 3.0
FINAL_STATES = {"received", "sent"}

app = Flask(__name__, static_folder="static", static_url_path="/static")


class RouterError(Exception):
    pass


# ---------- configurazione ----------

def load_config() -> dict:
    cfg = {
        "host": os.environ.get("ROUTER_HOST", ""),
        "user": os.environ.get("ROUTER_USER", "root"),
        "password": os.environ.get("ROUTER_PASSWORD", ""),
        "modem": os.environ.get("MODEM_INDEX", "0"),
    }
    try:
        with open(CONFIG_PATH) as f:
            cfg.update({k: v for k, v in json.load(f).items() if v not in (None, "")})
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return cfg


def save_config(cfg: dict) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cfg, f)
    os.chmod(tmp, 0o600)
    os.replace(tmp, CONFIG_PATH)


def is_configured(cfg: dict) -> bool:
    return bool(cfg["host"] and cfg["user"] and cfg["password"])


# ---------- SSH ----------

def run_remote(commands: list[str]) -> list[str]:
    """Esegue più comandi su una sola connessione SSH."""
    cfg = load_config()
    if not is_configured(cfg):
        raise RouterError("Router non configurato.")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            cfg["host"],
            username=cfg["user"],
            password=cfg["password"],
            timeout=8,
            banner_timeout=8,
            auth_timeout=8,
            look_for_keys=False,
            allow_agent=False,
        )
        results = []
        for command in commands:
            _, stdout, stderr = client.exec_command(command, timeout=20)
            results.append(stdout.read().decode(errors="replace") + stderr.read().decode(errors="replace"))
        return results
    except paramiko.AuthenticationException:
        raise RouterError("Credenziali rifiutate dal router.")
    except (paramiko.SSHException, OSError) as exc:
        raise RouterError(f"Router non raggiungibile ({exc.__class__.__name__}).")
    finally:
        client.close()


# ---------- SMS ----------

def field(output: str, name: str) -> str:
    m = re.search(rf"^\s*(?:[\w.-]+\s*\|\s*)?{name}:\s*(.*)$", output, re.M)
    return m.group(1).strip().strip("'") if m else ""


def parse_detail(sms_id: str, output: str) -> dict:
    try:
        sms = json.loads(output)["sms"]
        content, props = sms["content"], sms["properties"]
        number, text = content.get("number") or "", content.get("text") or ""
        state, stamp, pdu = props.get("state") or "", props.get("timestamp") or "", props.get("pdu-type") or ""
    except (ValueError, KeyError, TypeError):
        number, text = field(output, "number"), field(output, "text")
        state, stamp, pdu = field(output, "state"), field(output, "timestamp"), field(output, "pdu type")
    outgoing = pdu == "submit" or state in {"sending", "sent"}
    return {
        "id": int(sms_id),
        "number": number if number != "--" else "",
        "text": text if text != "--" else "",
        "state": state,
        "timestamp": stamp if stamp != "--" else "",
        "outgoing": outgoing,
    }


_lock = threading.Lock()
_details: dict[int, dict] = {}
_snapshot = {"at": 0.0, "messages": []}


def invalidate() -> None:
    _snapshot["at"] = 0.0


def fetch_messages() -> list[dict]:
    with _lock:
        if time.monotonic() - _snapshot["at"] < CACHE_TTL:
            return _snapshot["messages"]
        modem = shlex.quote(load_config()["modem"])
        (listing,) = run_remote([f"mmcli -m {modem} --messaging-list-sms"])
        states = {int(i): s for i, s in re.findall(r"/SMS/(\d+)\s*\(([^)]+)\)", listing)}
        # Gli SMS in stato finale non cambiano: si rileggono solo i nuovi o quelli in transito.
        stale = [
            i for i, s in states.items()
            if i not in _details or _details[i]["state"] != s or s not in FINAL_STATES
        ]
        if stale:
            outputs = run_remote([f"mmcli -m {modem} -s {i} -J" for i in stale])
            for i, out in zip(stale, outputs):
                _details[i] = parse_detail(str(i), out)
        for i in [i for i in _details if i not in states]:
            del _details[i]
        _snapshot["messages"] = [_details[i] for i in sorted(states)]
        _snapshot["at"] = time.monotonic()
        return _snapshot["messages"]


def mmcli_quote(value: str) -> str:
    return "'" + value.replace("'", r"'\''") + "'"


def send_sms(number: str, text: str) -> int:
    modem = shlex.quote(load_config()["modem"])
    value = f"text={mmcli_quote(text)},number={mmcli_quote(number)}"
    (created,) = run_remote([f"mmcli -m {modem} --messaging-create-sms={shlex.quote(value)}"])
    m = re.search(r"/SMS/(\d+)", created)
    if not m:
        raise RouterError(f"Creazione fallita: {created.strip()[:200]}")
    new_id = m.group(1)
    (sent,) = run_remote([f"mmcli -m {modem} -s {new_id} --send"])
    if "error" in sent.lower() or "fail" in sent.lower():
        raise RouterError(f"Invio fallito: {sent.strip()[:200]}")
    invalidate()
    return int(new_id)


def delete_sms(ids: list[int]) -> None:
    modem = shlex.quote(load_config()["modem"])
    run_remote([f"mmcli -m {modem} --messaging-delete-sms={i}" for i in ids])
    for i in ids:
        _details.pop(i, None)
    invalidate()


# ---------- API ----------

def api_error(message: str, status: int = 502):
    return jsonify(error=message), status


@app.errorhandler(RouterError)
def handle_router_error(exc):
    return api_error(str(exc))


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/messages")
def api_messages():
    if not is_configured(load_config()):
        return jsonify(configured=False, messages=[])
    messages = fetch_messages()
    etag = hashlib.sha1(json.dumps(messages, sort_keys=True).encode()).hexdigest()[:16]
    if request.headers.get("If-None-Match") == f'"{etag}"':
        return "", 304
    resp = jsonify(configured=True, messages=messages)
    resp.set_etag(etag)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.post("/api/send")
def api_send():
    body = request.get_json(silent=True) or {}
    number = str(body.get("number", "")).strip().replace(" ", "")
    text = str(body.get("text", ""))
    if not re.fullmatch(r"\+?\d{3,20}", number):
        return api_error("Numero non valido. Usa il formato +391234567890.", 400)
    if not text.strip() or len(text) > 1000:
        return api_error("Il testo deve contenere da 1 a 1000 caratteri.", 400)
    return jsonify(id=send_sms(number, text))


@app.post("/api/delete")
def api_delete():
    body = request.get_json(silent=True) or {}
    ids = body.get("ids")
    if not isinstance(ids, list) or not ids or not all(isinstance(i, int) and i >= 0 for i in ids):
        return api_error("Richiesta non valida.", 400)
    delete_sms(ids)
    return jsonify(deleted=ids)


@app.get("/api/config")
def api_get_config():
    cfg = load_config()
    return jsonify(
        configured=is_configured(cfg),
        host=cfg["host"],
        user=cfg["user"],
        modem=cfg["modem"],
        has_password=bool(cfg["password"]),
    )


@app.put("/api/config")
def api_put_config():
    body = request.get_json(silent=True) or {}
    current = load_config()
    new = {
        "host": str(body.get("host", "")).strip(),
        "user": str(body.get("user", "")).strip() or "root",
        "password": str(body.get("password", "")) or current["password"],
        "modem": str(body.get("modem", "0")).strip() or "0",
    }
    if not re.fullmatch(r"[\w.\-:]+", new["host"]):
        return api_error("Indirizzo del router non valido.", 400)
    if not new["modem"].isdigit():
        return api_error("L'indice del modem deve essere un numero.", 400)
    if not new["password"]:
        return api_error("Inserisci la password del router.", 400)
    previous = dict(current)
    save_config(new)
    _details.clear()
    invalidate()
    try:
        run_remote([f"mmcli -m {shlex.quote(new['modem'])} --messaging-list-sms"])
    except RouterError as exc:
        if is_configured(previous):
            save_config(previous)
        else:
            try:
                os.remove(CONFIG_PATH)
            except FileNotFoundError:
                pass
        return api_error(str(exc))
    return jsonify(configured=True)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
