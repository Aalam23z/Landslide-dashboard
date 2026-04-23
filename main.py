import joblib
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

obj = joblib.load("newlogic.pkl")
model = obj["trained_pipeline"]
features = obj["features"]

latest_data = {}
latest_risk = "UNKNOWN"
latest_confidence = 0.0


class SensorData(BaseModel):
    soil: float
    rain: float
    humidity: float
    tilt: float


@app.get("/")
def home():
    return {"message": "Landslide backend is running"}


@app.post("/sensor-data")
def receive_data(data: SensorData):
    global latest_data, latest_risk, latest_confidence

    latest_data = data.dict()

    input_df = pd.DataFrame([{
        "soil_moisture_raw": latest_data["soil"],
        "rain_sensor_raw": latest_data["rain"],
        "humidity_pct": latest_data["humidity"],
        "tilt_deg": latest_data["tilt"]
    }])

    input_df = input_df[features]

    pred = model.predict(input_df)[0]
    probs = model.predict_proba(input_df)[0]

    risk_map = {
        0: "SAFE",
        1: "MEDIUM",
        2: "CRITICAL"
    }

    latest_risk = risk_map.get(int(pred), "UNKNOWN")
    latest_confidence = float(max(probs))

    return {
        "risk": latest_risk,
        "confidence": latest_confidence,
        "data": latest_data
    }


@app.get("/latest")
def get_latest():
    return {
        "risk": latest_risk,
        "confidence": latest_confidence,
        "data": latest_data
    }
