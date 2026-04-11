void setup() {
  Serial.begin(9600);
}

void loop() {
  int moisture = analogRead(A0);  // Soil
  int rain = analogRead(A1);      // Rain

  int humidity = 70;   // keep dummy for now
  float tilt = 0.04;   // keep dummy

  // --- Soil Moisture % ---
  float moisture_percent = (moisture / 1023.0) * 100;

  // --- Rain Classification ---
  String rain_status;

  if (rain >= 800) {
    rain_status = "SAFE";
  } 
  else if (rain >= 500) {
    rain_status = "WARNING";
  } 
  else if (rain >= 200) {
    rain_status = "CRITICAL";
  } 
  else {
    rain_status = "DANGER";
  }

  // Send data (KEEP SAME FORMAT for Python)
  Serial.print(moisture_percent);
  Serial.print(",");
  Serial.print(rain);
  Serial.print(",");
  Serial.print(humidity);
  Serial.print(",");
  Serial.println(tilt);

  delay(2000);
}