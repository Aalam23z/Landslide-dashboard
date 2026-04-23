mport json
import time
import serial
import requests

SERIAL_PORT = "COM6"   # Change if needed
BAUD = 9600
BACKEND = "BACKEND = "http://127.0.0.1:8000/sensor-data"
SMS_COOLDOWN = 60
REQUEST_TIMEOUT = 8

last_sms_time = 0


def parse(line: str):
    try:
        start = line.find("{")
        end = line.rfind("}")
        if start == -1 or end == -1:
            return None
        return json.loads(line[start:end + 1])
    except Exception:
        return None


def send_to_backend(data: dict):
    res = requests.post(BACKEND, json=data, timeout=REQUEST_TIMEOUT)
    res.raise_for_status()
    return res.json()


def main():
    global last_sms_time

    with serial.Serial(SERIAL_PORT, BAUD, timeout=2) as ser:
        print(f"Connected to Arduino on {SERIAL_PORT}")
        time.sleep(2)

        while True:
            try:
                raw = ser.readline().decode(errors="ignore").strip()
                if not raw:
                    continue

                data = parse(raw)
                if not data:
                    print("[SKIP] Non-JSON line:", raw)
                    continue

                print("[DATA]", data)

                result = send_to_backend(data)
                risk = result.get("risk", "UNKNOWN")
                confidence = result.get("confidence", 0)
                print(f"[RISK] {risk} | confidence={confidence:.3f}")

                now = time.time()
                if risk == "CRITICAL" and (now - last_sms_time > SMS_COOLDOWN):
                    print("[ACTION] Triggering SMS")
                    ser.write(b"SEND_SMS
")
                    last_sms_time = now

            except requests.exceptions.RequestException as e:
                print("[HTTP ERROR]", e)
            except serial.SerialException as e:
                print("[SERIAL ERROR]", e)
                break
            except Exception as e:
                print("[ERROR]", e)

            time.sleep(1)


if __name__ == "__main__":
    main()
