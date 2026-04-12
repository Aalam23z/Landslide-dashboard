import requests
import time
import random

url = "http://127.0.0.1:8000/sensor-data"

print("Simulating Sensor Data...\n")

while True:
    payload = {
        "moisture": random.randint(100, 300),
        "rain": random.randint(0, 3),
        "humidity": random.randint(40, 90),
        "tilt": 5
    }

    try:
        response = requests.post(url, json=payload)
        print("Sent:", payload)
        print("Response:", response.json())
        print("----------------------------------")
    except Exception as e:
        print("Error:", e)

    time.sleep(3)