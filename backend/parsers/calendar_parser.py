from ics import Calendar
import requests
from datetime import datetime


def parse_calendar(url):
    r = requests.get(url)
    c = Calendar(r.text)
    events = []
    for event in c.events:
        events.append({
            "name": event.name,
            "begin": event.begin.format("YYYY-MM-DD HH:mm"),
            "end": event.end.format("YYYY-MM-DD HH:mm") if event.end else None
        })
    return events
