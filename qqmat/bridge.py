import asyncio, json, yaml, time
from aiohttp import ClientSession

with open("config.yaml") as f:
    cfg = yaml.safe_load(f)

OB = cfg["onebot"]
MT = cfg["matrix"]
PROXY = MT.get("proxy")
MH = {"Authorization": f"Bearer {MT['access_token']}"}
OH = {"Authorization": f"Bearer {OB['token']}"}
HS = MT["homeserver"]
ROOM = MT["room_id"]

display_names = {}
LOG = lambda *a: print(f"[{time.strftime('%H:%M:%S')}]", *a, flush=True)

async def get_display_name(user_id):
    if user_id in display_names:
        return display_names[user_id]
    try:
        async with ClientSession() as s:
            async with s.get(f"{HS}/_matrix/client/v3/profile/{user_id}/displayname",
                             headers=MH, proxy=PROXY) as r:
                dn = (await r.json()).get("displayname", user_id)
        display_names[user_id] = dn.replace(' (Telegram)', '')
        return display_names[user_id]
    except Exception:
        return user_id

async def matrix_send_text(body):
    async with ClientSession() as s:
        txn = int(time.time() * 1e6)
        async with s.put(f"{HS}/_matrix/client/v3/rooms/{ROOM}/send/m.room.message/{txn}",
                         json={"msgtype": "m.text", "body": body}, headers=MH, proxy=PROXY) as r:
            return (await r.json()).get("event_id", "")

async def qq_send_text(text):
    async with ClientSession() as s:
        await s.post(f"{OB['http_url']}/send_group_msg",
                     headers=OH, json={"group_id": OB["qq_group_id"], "message": text})

async def qq_loop():
    while True:
        try:
            async with ClientSession() as s:
                async with s.ws_connect(OB["ws_url"], headers=OH) as ws:
                    LOG("[QQ] connected")
                    async for msg in ws:
                        data = json.loads(msg.data)
                        if data.get("post_type") != "message": continue
                        if data.get("message_type") != "group": continue
                        if data.get("group_id") != OB["qq_group_id"]: continue
                        text = data["raw_message"]
                        sender = data["sender"]["nickname"]
                        await matrix_send_text(f"[QQ] {sender}: {text}")
                        LOG(f"[Q→M] {sender}: {text[:30]}")
        except Exception as e:
            LOG(f"[QQ] {e}, retry 3s")
            await asyncio.sleep(3)

async def matrix_loop():
    since = None
    while True:
        try:
            url = f"{HS}/_matrix/client/v3/sync?timeout=30000"
            if since: url += f"&since={since}"
            async with ClientSession() as s:
                async with s.get(url, headers=MH, proxy=PROXY) as r:
                    resp = await r.json()
            since = resp.get("next_batch", since)

            for room_id, room_data in resp.get("rooms", {}).get("join", {}).items():
                if room_id != ROOM: continue
                for ev in room_data.get("timeline", {}).get("events", []):
                    if ev.get("type") != "m.room.message": continue
                    if ev.get("sender") == MT["user_id"]: continue
                    body = ev.get("content", {}).get("body", "").strip()
                    if not body: continue
                    sender_name = await get_display_name(ev["sender"])
                    await qq_send_text(f"[Matrix] {sender_name}: {body}")
                    LOG(f"[M→Q] {sender_name}: {body[:30]}")
        except Exception as e:
            LOG(f"[Matrix] {e}, retry 3s")
            await asyncio.sleep(3)

async def main():
    LOG(f"[Bridge] QQ={OB['qq_group_id']} Matrix={ROOM}")
    await asyncio.gather(qq_loop(), matrix_loop())

asyncio.run(main())
