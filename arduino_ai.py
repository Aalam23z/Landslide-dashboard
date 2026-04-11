import serial
import requests

# Ask COM port (flexible for demo)
port = input("Enter COM port (e.g., COM6): ")

if not port:
    port = "COM6"   # default fallback


ser = serial.Serial(port, 9600)

url = "http://127.0.0.1:8000/sensor-data"

print("Reading Arduino Data...\n")

while True:
    data = ser.readline().decode().strip()

    try:
        values = list(map(float, data.split(",")))

        payload = {
            "moisture": values[0],
            "rain": values[1],
            "humidity": values[2],
            "tilt": 5   # fixed (since sensor not working)
        }

        response = requests.post(url, json=payload)

        print("Sent:", payload)
        print("Response:", response.json())
        print("----------------------------------")

    except Exception as e:
        print("Error:", e)
        print("Raw data:", data)