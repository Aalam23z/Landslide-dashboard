#include <DHT.h>
#include <SoftwareSerial.h>

// ---------- DHT22 ----------
#define DHTPIN 4
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

// ---------- Sensors ----------
#define RAIN_PIN A1        // Digital rain
#define SOIL_PIN A0         // Analog soil
#define TILT_PIN A2         // Optional (or fake)

// ---------- SIM900A ----------
SoftwareSerial sim(7, 8); // RX, TX

// ---------- Numbers ----------
String num1 = "+919633390013";
String num2 = "+918610734418";
String num3 = "+918778258545";

bool smsSent = false;

// ---------- Setup ----------
void setup() {
  Serial.begin(9600);
  sim.begin(9600);

  pinMode(RAIN_PIN, INPUT);
  dht.begin();

  delay(5000); // SIM boot

  Serial.println("System Ready...");
}

// ---------- Loop ----------
void loop() {
  // ---- Read Sensors ----
  int rainDigital = digitalRead(RAIN_PIN);   // 0 = rain
  int soilRaw = analogRead(SOIL_PIN);
  int soil = map(soilRaw, 0, 1023, 100, 0);  // % inverted
  float humidity = dht.readHumidity();

  // ---- Tilt (replace with MPU later) ----
  float tilt = map(analogRead(TILT_PIN), 0, 1023, 0, 10);

  // ---- Risk Logic (local fallback only) ----
  int risk = 0; // 0 SAFE, 1 MEDIUM, 2 CRITICAL

  if (rainDigital == 0 && soil > 75 && humidity > 80 && tilt > 6) {
    risk = 2; // CRITICAL
  }
  else if (soil > 50 || humidity > 65 || tilt > 3) {
    risk = 1; // MEDIUM
  }

  // ---- Send JSON to Python ----
  Serial.print("{");
  Serial.print("\"rain\":"); Serial.print(rainDigital == 0 ? 100 : 0);
  Serial.print(",\"soil\":"); Serial.print(soil);
  Serial.print(",\"humidity\":"); Serial.print(humidity);
  Serial.print(",\"tilt\":"); Serial.print(tilt);
  Serial.println("}");

  // ---- Check command from Python ----
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd == "SEND_SMS") {
      sendSMS();
    }
  }

  delay(2000);
}

// ---------- SMS FUNCTION ----------
void sendSMS() {
  Serial.println("Sending SMS...");

  sendToNumber(num1);
  sendToNumber(num2);
  sendToNumber(num3);
}

void sendToNumber(String number) {
  sim.println("AT");
  delay(500);

  sim.println("AT+CMGF=1");
  delay(500);

  sim.print("AT+CMGS=\"");
  sim.print(number);
  sim.println("\"");
  delay(500);

  sim.println("⚠ CRITICAL LANDSLIDE RISK DETECTED!");
  delay(200);

  sim.write(26); // CTRL+Z
  delay(5000);

  Serial.println("SMS sent to " + number);
}