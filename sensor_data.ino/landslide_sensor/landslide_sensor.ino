#include <DHT.h>
#include <SoftwareSerial.h>

// ---------- DHT22 ----------
#define DHTPIN 4
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

// ---------- Sensors ----------
#define RAIN_PIN A1
#define SOIL_PIN A0
#define TILT_PIN A2   // fake / optional tilt input

// ---------- SIM900A ----------
SoftwareSerial sim(7, 8); // RX, TX

// ---------- Numbers ----------
String num1 = "+919633390013";
String num2 = "+918610734418";
String num3 = "+918778258545";

// ---------- State ----------
float lastHumidity = 50.0;   // fallback if DHT gives NaN

void setup() {
  Serial.begin(9600);
  sim.begin(9600);

  pinMode(RAIN_PIN, INPUT);
  pinMode(SOIL_PIN, INPUT);
  pinMode(TILT_PIN, INPUT);

  dht.begin();

  delay(5000); // SIM boot
  Serial.println("System Ready...");
}

void loop() {
  // ---- Read raw sensors ----
  int rainRaw = analogRead(RAIN_PIN);   // expected raw style: 0 to 1023
  int soilRaw = analogRead(SOIL_PIN);   // expected raw style: 0 to 1023

  float humidity = dht.readHumidity();
  if (isnan(humidity)) {
    humidity = lastHumidity;
  } else {
    lastHumidity = humidity;
  }

  // ---- Fake / temporary tilt ----
  float tilt = map(analogRead(TILT_PIN), 0, 1023, 0, 15);

  // ---- Optional local fallback logic only ----
  int localRisk = 0; // 0 SAFE, 1 MEDIUM, 2 CRITICAL

  if (rainRaw < 250 && soilRaw < 400 && humidity > 85 && tilt > 10) {
    localRisk = 2;
  }
  else if (rainRaw < 650 || soilRaw < 650 || humidity > 70 || tilt > 4) {
    localRisk = 1;
  }

  // ---- Send JSON to Python ----
  Serial.print("{");
  Serial.print("\"rain\":"); Serial.print(rainRaw);
  Serial.print(",\"soil\":"); Serial.print(soilRaw);
  Serial.print(",\"humidity\":"); Serial.print(humidity, 1);
  Serial.print(",\"tilt\":"); Serial.print(tilt, 2);
  Serial.print(",\"localRisk\":"); Serial.print(localRisk);
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

  sim.println("CRITICAL LANDSLIDE RISK DETECTED!");
  delay(200);

  sim.write(26); // CTRL+Z
  delay(5000);

  Serial.println("SMS sent to " + number);
}