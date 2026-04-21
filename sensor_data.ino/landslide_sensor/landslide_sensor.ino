#include <SoftwareSerial.h>
#include <DHT.h>

// ─── Pins ─────────────────────────────
#define SOIL_PIN A0
#define RAIN_PIN A1
#define DHT_PIN  4

SoftwareSerial gsm(7, 8);
DHT dht(DHT_PIN, DHT22);

// ─── Phone Numbers ────────────────────
String numbers[] = {
  "+917899056484",
  "+916301011375",
  "+917889577563"
};
int numCount = 3;

// ─── Timing ───────────────────────────
unsigned long lastRead = 0;
const unsigned long INTERVAL = 2500;

// ─── Serial Buffer ────────────────────
String cmd = "";

// ─── Sensor Calibration ───────────────
// Both sensors are INVERTED — high raw = dry, low raw = wet
const int SOIL_DRY = 1023;
const int SOIL_WET = 300;

const int RAIN_DRY = 1023;
const int RAIN_WET = 200;

// ─── Tilt / Risk State ────────────────
int riskLevel = 0;

float fakeTiltX = 0.5;
float fakeTiltY = 0.3;
float fakeTiltZ = 9.8;

// ─── Update Fake Accel Based on Risk ──
void updateFakeMPU() {
  float baseX, baseY, noise;

  if (riskLevel == 0) {
    baseX = 0.5;  baseY = 0.3;  noise = 0.05;
  } else if (riskLevel == 1) {
    baseX = 1.2;  baseY = 0.9;  noise = 0.10;
  } else if (riskLevel == 2) {
    baseX = 3.5;  baseY = 2.8;  noise = 0.20;
  } else {
    baseX = 7.5;  baseY = 6.2;  noise = 0.40;
  }

  // Add small realistic sensor noise around the base value
  fakeTiltX = baseX + ((random(-10, 10)) * noise * 0.1);
  fakeTiltY = baseY + ((random(-10, 10)) * noise * 0.1);

  // Z-axis drops as tilt increases (gravity shifts to X/Y)
  float mag = sqrt(fakeTiltX * fakeTiltX + fakeTiltY * fakeTiltY);
  fakeTiltZ = sqrt(max(0.0, 9.81 * 9.81 - mag * mag));
}

// ─── Combined Risk Level ──────────────
// All 3 sensors must agree to push risk higher
// soil=44% and rain=44% will stay at safe/low
// only if ALL three are high does it go critical
int getRiskLevel(float tilt, int soilPercent, int rainPercent) {
  if (tilt < 2.0 && soilPercent < 30 && rainPercent < 30) return 0;  // safe
  if (tilt < 5.0 && soilPercent < 60 && rainPercent < 60) return 1;  // low
  if (tilt < 9.0 && soilPercent < 80 && rainPercent < 80) return 2;  // medium
  return 3;                                                            // critical
}

// ─── Setup ────────────────────────────
void setup() {
  Serial.begin(9600);
  gsm.begin(9600);
  dht.begin();
  randomSeed(analogRead(A2));

  delay(2000);

  gsm.println("AT");
  delay(500);
  gsm.println("AT+CMGF=1");
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
    gsm.write(26);
    delay(5000);
  }
  Serial.println("[SMS SENT]");
}

// ─── Loop ─────────────────────────────
void loop() {
  unsigned long now = millis();

  if (now - lastRead >= INTERVAL) {
    lastRead = now;

    // ── Soil & Rain Raw ───────────────────────────────────
    int soilRaw = analogRead(SOIL_PIN);
    int rainRaw = analogRead(RAIN_PIN);

    // ── Convert to percentage (inverted mapping) ──────────
    // 1023 (dry) → 0%   |   WET value → 100%
    int soilPercent = map(soilRaw, SOIL_DRY, SOIL_WET, 0, 100);
    int rainPercent = map(rainRaw, RAIN_DRY, RAIN_WET, 0, 100);

    // Clamp to 0–100 in case raw value goes beyond calibration range
    soilPercent = constrain(soilPercent, 0, 100);
    rainPercent = constrain(rainPercent, 0, 100);

    // ── DHT22 ─────────────────────────────────────────────
    float temp     = dht.readTemperature();
    float humidity = dht.readHumidity();

    bool tempValid = !isnan(temp);
    bool humValid  = !isnan(humidity);

    // ── Fake MPU6050 ──────────────────────────────────────
    updateFakeMPU();

    float tilt = sqrt(fakeTiltX * fakeTiltX + fakeTiltY * fakeTiltY);

    // ── Risk Level (all 3 sensors combined) ───────────────
    riskLevel = getRiskLevel(tilt, soilPercent, rainPercent);

    // ── JSON Output ───────────────────────────────────────
    String json = "{";
    json += "\"moisture\":"   + String(soilPercent)                         + ",";  // 0=dry  100=wet
    json += "\"rain\":"       + String(rainPercent)                         + ",";  // 0=none 100=heavy
    json += "\"humidity\":"   + (humValid  ? String(humidity, 1) : "null")  + ",";
    json += "\"temp\":"       + (tempValid ? String(temp, 1)     : "null")  + ",";
    json += "\"tilt\":"       + String(tilt, 2)                             + ",";
    json += "\"risk_level\":" + String(riskLevel);  // 0=safe 1=low 2=medium 3=critical
    json += "}";

    Serial.println(json);

    // ── Auto SMS on critical risk ─────────────────────────
    if (riskLevel == 3) {
      sendSMS("LANDSLIDE ALERT! HIGH RISK DETECTED");
    }
  }

  // ── Non-blocking Serial Command Receiver ──────────────
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
