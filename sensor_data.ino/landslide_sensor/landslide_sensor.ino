#include <SoftwareSerial.h>
#include <DHT.h>

// ─── Pins ─────────────────────────────
#define SOIL_PIN A0
#define RAIN_PIN A1
#define DHT_PIN  2

SoftwareSerial gsm(7, 8);  // SIM900A RX, TX
DHT dht(DHT_PIN, DHT22);

// ─── Phone Numbers ────────────────────
String numbers[] = {
  "+919633390013",
  "+911234567890",
  "+919876543210"
};
int numCount = 3;

// ─── Timing ───────────────────────────
unsigned long lastRead = 0;
const unsigned long INTERVAL = 2000;

// ─── Serial Buffer ────────────────────
String cmd = "";

// ─── Setup ────────────────────────────
void setup() {
  Serial.begin(9600);
  gsm.begin(9600);
  dht.begin();

  delay(2000);

  // GSM init
  gsm.println("AT");
  delay(500);
  gsm.println("AT+CMGF=1");  // text mode
  delay(500);

  Serial.println("SYSTEM READY");
}

// ─── Send SMS ─────────────────────────
void sendSMS(String msg) {
  for (int i = 0; i < numCount; i++) {
    gsm.println("AT+CMGS=\"" + numbers[i] + "\"");
    delay(1000);

    gsm.print(msg);
    delay(500);

    gsm.write(26); // CTRL+Z
    delay(5000);
  }

  Serial.println("[SMS SENT]");
}

// ─── Loop ─────────────────────────────
void loop() {
  unsigned long now = millis();

  // ── Send sensor data ──
  if (now - lastRead >= INTERVAL) {
    lastRead = now;

    int soil = analogRead(SOIL_PIN);
    int rain = analogRead(RAIN_PIN);

    float temp = dht.readTemperature();
    float humidity = dht.readHumidity();

    // FIXED: no invalid values sent to ML
    if (isnan(temp)) temp = 25.0;
    if (isnan(humidity)) humidity = 50.0;

    // Fake tilt for testing
    float tilt = 3.0;

    // JSON output
    String json = "{";
    json += "\"moisture\":" + String(soil) + ",";
    json += "\"rain\":" + String(rain) + ",";
    json += "\"humidity\":" + String(humidity, 1) + ",";
    json += "\"temp\":" + String(temp, 1) + ",";
    json += "\"tilt\":" + String(tilt, 2);
    json += "}";

    Serial.println(json);
  }

  // ── NON-BLOCKING SERIAL COMMAND RECEIVER ──
  while (Serial.available()) {
    char c = Serial.read();

    if (c == '\n') {
      cmd.trim();

      Serial.print("[CMD RECEIVED]: ");
      Serial.println(cmd);

      if (cmd == "SEND_SMS") {
        sendSMS("LANDSLIDE ALERT! HIGH RISK DETECTED");
      }

      cmd = "";
    } else {
      cmd += c;
    }
  }
}