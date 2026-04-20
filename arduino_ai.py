import serial
import requests
import json
import time

SERIAL_PORT = "COM6"   # Arduino USB
BAUD = 9600
BACKEND = "https://landslide-backend-gip0.onrender.com/sensor-data"

last_sms_time = 0
SMS_COOLDOWN = 60  # seconds

def parse(line):
    try:
        start = line.find("{")
        end = line.rfind("}")
        if start == -1 or end == -1:
            return None
        return json.loads(line[start:end+1])
    except:
        return None

def main():
    global last_sms_time

    with serial.Serial(SERIAL_PORT, BAUD, timeout=2) as ser:
        print("Connected to Arduino\n")

        while True:
            line = ser.readline().decode(errors="ignore").strip()
            if not line:
                continue

            data = parse(line)
            if not data:
                continue

            print("[DATA]", data)

            try:
                res = requests.post(BACKEND, json=data, timeout=5)
                result = res.json()

                risk = result.get("risk", "UNKNOWN")
                print("[RISK]", risk)

                now = time.time()

                if risk == "HIGH" and (now - last_sms_time > SMS_COOLDOWN):
                    print("[ACTION] Triggering SMS")
                    ser.write(b"SEND_SMS\n")
                    last_sms_time = now

            except Exception as e:
                print("[ERROR]", e)

            time.sleep(1)

if __name__ == "__main__":
    main()