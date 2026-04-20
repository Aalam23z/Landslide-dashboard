from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

model = joblib.load("landslide_model.pkl")

latest_data = {}
latest_risk = "UNKNOWN"

class SensorData(BaseModel):
    moisture: float
    rain: float
    humidity: float
    tilt: float

@app.post("/sensor-data")
def receive_data(data: SensorData):
    global latest_data, latest_risk

    latest_data = data.dict()

    input_data = [[
        latest_data["moisture"],
        latest_data["rain"],
        latest_data["humidity"],
        latest_data["tilt"]
    ]]

    result = model.predict(input_data)

    risk_map = {0: "LOW", 1: "MEDIUM", 2: "HIGH"}
    latest_risk = risk_map.get(result[0], "UNKNOWN")

    return {
        "risk": latest_risk,
        "data": latest_data
    }

@app.get("/latest")
def get_latest():
    return {
        "risk": latest_risk,
        "data": latest_data
    }