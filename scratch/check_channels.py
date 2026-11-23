import requests

try:
    r = requests.get('http://localhost:8000/channels')
    data = r.json()
    channels = data.get('channels', [])
    print(f"Total channels: {len(channels)}")
    live_count = 0
    for ch in channels:
        name = ch.get('name', '').encode('ascii', 'replace').decode('ascii')
        is_live = ch.get('is_live')
        status = ch.get('status')
        video_id = ch.get('live_video_id')
        if is_live:
            live_count += 1
        print(f"[{'LIVE' if is_live else 'OFFLINE'}] {name} ({ch.get('country_code')}): status={status}, video_id={video_id}")
    print(f"\nSummary: {live_count} live channels out of {len(channels)}")
except Exception as e:
    print("Error:", e)
