from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib

app = FastAPI()

# Allow frontend to access backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load model
model = joblib.load("landslide_model.pkl")

# Store latest sensor data
latest_data = {}

class SensorData(BaseModel):
    moisture: float
    rain: float
    humidity: float
    tilt: float

@app.post("/sensor-data")
def receive_data(data: SensorData):
    global latest_data
    latest_data = data.dict()
    return {"status": "received"}

@app.get("/predict")
def predict():
    if not latest_data:
        return {"error": "No sensor data available"}
    input_data = [[
        latest_data["moisture"],
        latest_data["rain"],
        latest_data["humidity"],
        latest_data["tilt"]
    ]]
    result = model.predict(input_data)
    risk_map = {0: "LOW", 1: "MEDIUM", 2: "HIGH"}
    return {
        "risk": risk_map.get(result[0], "UNKNOWN"),
        "data": latest_data
    }
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
