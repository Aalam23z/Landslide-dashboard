import time

# Thresholds
RATE_SAFE = 0.01
RATE_WARNING = 0.1

ANGLE_SAFE = 5
ANGLE_WARNING = 15

prev_angle = None
prev_time = None

def classify(angle, rate_per_hour):
    # Rate-based (priority)
    if rate_per_hour > RATE_WARNING:
        return "CRITICAL"
    elif rate_per_hour > RATE_SAFE:
        return "WARNING"
    
    # Angle-based fallback
    if abs(angle) > ANGLE_WARNING:
        return "CRITICAL"
    elif abs(angle) > ANGLE_SAFE:
        return "WARNING"
    
    return "SAFE"


def process_sensor(angle):
    global prev_angle, prev_time

    current_time = time.time()

    if prev_angle is None:
        prev_angle = angle
        prev_time = current_time
        return "INITIALIZING"

    dt = current_time - prev_time

    if dt == 0:
        return "ERROR"

    rate = (angle - prev_angle) / dt
    rate_per_hour = rate * 3600

    status = classify(angle, rate_per_hour)

    prev_angle = angle
    prev_time = current_time

    print(f"Angle: {angle:.2f} | Rate: {rate_per_hour:.5f} °/h | Status: {status}")

    return status