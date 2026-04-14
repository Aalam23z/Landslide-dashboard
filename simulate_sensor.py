import serial
import requests
import time

# 🔌 COM PORT
port = input("Enter COM port (e.g., COM6): ")
if not port:
    port = "COM6"

ser = serial.Serial(port, 9600)

# 🌐 Render backend (HTTPS)
url = "https://landslide-backend-gip0.onrender.com/sensor-data"

print("Reading Sensor Data...\n")

while True:
    try:
        data = ser.readline().decode().strip()
        values = list(map(float, data.split(",")))

        payload = {
            "moisture": values[0],
            "rain": 1023 - values[1],
            "humidity": values[2],
            "tilt": 0   # keep fixed if sensor not working
        }

        response = requests.post(url, json=payload)

        print("Sent:", payload)
        print("Response:", response.json())
        print("----------------------------------")

    except Exception as e:
        print("Error:", e)
        print("Raw:", data)

    time.sleep(3)