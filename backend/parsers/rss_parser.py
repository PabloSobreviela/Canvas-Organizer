import feedparser, json, os

CACHE_PATH = "data/announcements_cache.json"

def parse_rss(url):
    feed = feedparser.parse(url)
    new_items = []

    for entry in feed.entries:
        new_items.append({
            "title": entry.title,
            "link": entry.link,
            "published": getattr(entry, "published", ""),
            "summary": getattr(entry, "summary", ""),
        })

    # Load old cache
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, "r", encoding="utf-8") as f:
            cached = json.load(f)
    else:
        cached = []

    existing_titles = {item["title"] for item in cached}
    for item in new_items:
        if item["title"] not in existing_titles:
            cached.append(item)

    # Save updated cache
    os.makedirs("data", exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cached, f, indent=2, ensure_ascii=False)

    return cached
