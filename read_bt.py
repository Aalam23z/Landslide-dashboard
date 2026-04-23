import serial
import time

PORT = 'COM8'
BAUD = 9600

def connect_bluetooth():
    while True:
        try:
            print(f"Trying to connect to {PORT}...")
            ser = serial.Serial(PORT, BAUD, timeout=1)
            print(f"Connected to {PORT}")
            return ser
        except Exception as e:
            print(f"Connection failed: {e}")
            print("Make sure HC-05 is paired and connected...")
            time.sleep(3)

ser = connect_bluetooth()

while True:
    try:
        if ser.in_waiting > 0:
            line = ser.readline().decode('utf-8').strip()
            if line:
                print("Received:", line)
    except Exception as e:
        print("Connection lost. Reconnecting...")
        ser.close()
        ser = connect_bluetooth()