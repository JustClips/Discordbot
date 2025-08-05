import os
import discord
import re
import requests
import base64
import json
from urllib.parse import unquote

TOKEN = os.getenv("DISCORD_TOKEN")

# Fix for empty CHANNEL_ID environment variable
CHANNEL_ID_ENV = os.getenv("CHANNEL_ID", "1234567890")
if not CHANNEL_ID_ENV or CHANNEL_ID_ENV.strip() == "":
    CHANNEL_IDS = [1234567890]  # Default fallback
else:
    CHANNEL_IDS = [int(cid.strip()) for cid in CHANNEL_ID_ENV.split(",") if cid.strip()]

WEBHOOK_URL = "https://discord.com/api/webhooks/1402358424414453920/kJbZBj2lmm0Ln0VtICnQNXLwgbupFO_ww60_SzZrqNkS3pfGUIDZfsGKicQqujXgRYzz"
BACKEND_URL = "https://discordbot-production-800b.up.railway.app/brainrots"

client = discord.Client()  # No intents!

def decrypt_job_id(encrypted_id):
    """
    Decrypt the encrypted Job ID to get the actual UUID
    """
    try:
        print(f"[DEBUG] Attempting to decrypt: {encrypted_id}")
        
        # Method 1: Try base64 decoding with proper padding
        try:
            # Add padding if needed
            missing_padding = len(encrypted_id) % 4
            if missing_padding:
                encrypted_id += '=' * (4 - missing_padding)
            
            decoded_bytes = base64.b64decode(encrypted_id)
            print(f"[DEBUG] Base64 decoded bytes: {decoded_bytes}")
            
            # Try to decode as UTF-8 string
            try:
                decoded_str = decoded_bytes.decode('utf-8')
                print(f"[DEBUG] Decoded string: {decoded_str}")
                
                # Look for UUID pattern in decoded string
                uuid_match = re.search(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', decoded_str, re.IGNORECASE)
                if uuid_match:
                    result = uuid_match.group(0).lower()
                    print(f"[DEBUG] Found UUID: {result}")
                    return result
                
                # Try to parse as JSON (in case it's JSON encoded)
                try:
                    json_data = json.loads(decoded_str)
                    if isinstance(json_data, dict):
                        for key, value in json_data.items():
                            if isinstance(value, str) and re.match(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', value, re.IGNORECASE):
                                result = value.lower()
                                print(f"[DEBUG] Found UUID in JSON: {result}")
                                return result
                except:
                    pass
                    
            except UnicodeDecodeError:
                print(f"[DEBUG] UTF-8 decode failed, trying hex interpretation")
                
        except Exception as e:
            print(f"[DEBUG] Base64 decode failed: {e}")
        
        # Method 2: Try interpreting decoded bytes as hex-encoded UUID
        try:
            missing_padding = len(encrypted_id) % 4
            if missing_padding:
                encrypted_id += '=' * (4 - missing_padding)
            
            decoded_bytes = base64.b64decode(encrypted_id)
            
            # If we have 16 bytes, it might be a binary UUID
            if len(decoded_bytes) == 16:
                # Convert bytes to hex and format as UUID
                hex_str = decoded_bytes.hex()
                formatted_uuid = f"{hex_str[:8]}-{hex_str[8:12]}-{hex_str[12:16]}-{hex_str[16:20]}-{hex_str[20:32]}"
                print(f"[DEBUG] Binary UUID converted: {formatted_uuid}")
                return formatted_uuid.lower()
            
            # Try to find UUID pattern in hex representation
            hex_str = decoded_bytes.hex()
            print(f"[DEBUG] Hex representation: {hex_str}")
            
            # Look for UUID-like patterns in the hex
            if len(hex_str) >= 32:
                # Try different UUID formats from the hex data
                for i in range(0, len(hex_str) - 31, 2):
                    chunk = hex_str[i:i+32]
                    if len(chunk) == 32:
                        formatted = f"{chunk[:8]}-{chunk[8:12]}-{chunk[12:16]}-{chunk[16:20]}-{chunk[20:32]}"
                        print(f"[DEBUG] Trying UUID format: {formatted}")
                        return formatted.lower()
                        
        except Exception as e:
            print(f"[DEBUG] Binary UUID decode failed: {e}")
        
        # Method 3: Try URL decoding first, then base64
        try:
            url_decoded = unquote(encrypted_id)
            if url_decoded != encrypted_id:
                print(f"[DEBUG] URL decoded: {url_decoded}")
                return decrypt_job_id(url_decoded)  # Recursive call
        except Exception as e:
            print(f"[DEBUG] URL decode failed: {e}")
        
        # Method 4: Custom algorithm based on your specific encoding
        # You might need a specific decryption key or algorithm here
        
        print(f"[DEBUG] All decryption methods failed, returning original: {encrypted_id}")
        return encrypted_id  # Return original if all methods fail
        
    except Exception as e:
        print(f"[ERROR] Decryption error: {e}")
        return encrypted_id  # Return original on error

def clean_field(text):
    """Remove markdown formatting and extra whitespace"""
    if not text:
        return text
    # Remove ``` code block formatting
    text = re.sub(r'```([^`]+)```', r'\1', text)
    # Remove ** bold formatting
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    # Remove * italic formatting  
    text = re.sub(r'\*(.*?)\*', r'\1', text)
    # Remove extra whitespace
    return text.strip()

def parse_info_from_embed(message):
    """Parse information from Discord embed fields"""
    info = {
        "name": None,
        "money": None,
        "players": None,
        "jobid_mobile": None,
        "jobid_pc": None,
        "jobid_ios": None,
        "instanceid": None,
        "placeid": "109983668079237"
    }
    
    print(f"[DEBUG] Processing message with {len(message.embeds)} embeds")
    
    for embed in message.embeds:
        print(f"[DEBUG] Embed title: {embed.title}")
        print(f"[DEBUG] Embed description: {embed.description}")
        print(f"[DEBUG] Embed has {len(embed.fields)} fields")
        
        for field in embed.fields:
            field_name = field.name.lower().strip()
            field_value = clean_field(field.value)
            
            print(f"[DEBUG] Field: '{field.name}' = '{field.value}' (cleaned: '{field_value}')")
            
            # Match field names (case insensitive)
            if "name" in field_name:
                info["name"] = field_value
            elif "money" in field_name or "per sec" in field_name:
                info["money"] = field_value
            elif "players" in field_name:
                info["players"] = field_value
            elif "id (mobile)" in field_name or "mobile" in field_name:
                # Decrypt the job ID
                info["jobid_mobile"] = decrypt_job_id(field_value)
            elif "id (pc)" in field_name or "(pc)" in field_name:
                # Decrypt the job ID
                info["jobid_pc"] = decrypt_job_id(field_value)
            elif "id (ios)" in field_name or "(ios)" in field_name:
                # Decrypt the job ID
                info["jobid_ios"] = decrypt_job_id(field_value)
    
    # Set instanceid (prefer PC, then iOS, then Mobile)
    info["instanceid"] = (
        info["jobid_pc"] if info["jobid_pc"] else
        info["jobid_ios"] if info["jobid_ios"] else
        info["jobid_mobile"] if info["jobid_mobile"] else
        None
    )
    
    return info

def parse_info_from_content(msg):
    """Fallback: Parse information from message content (old method)"""
    print(f"[DEBUG] Fallback parsing from content")
    
    # Try multiple formats:
    name = re.search(r'🏷️\s*Name\s*\n([^\n]+)', msg, re.MULTILINE | re.IGNORECASE)
    if not name:
        name = re.search(r':settings:\s*Name\s*\n([^\n]+)', msg, re.MULTILINE | re.IGNORECASE)
    if not name:
        name = re.search(r'<:settings:\d+>\s*Name\s*\n([^\n]+)', msg, re.MULTILINE | re.IGNORECASE)
    
    money = re.search(r'💰\s*Money per sec\s*\n([^\n]+)', msg, re.MULTILINE | re.IGNORECASE)
    if not money:
        money = re.search(r':media:\s*Money per sec\s*\n([^\n]+)', msg, re.MULTILINE | re.IGNORECASE)
    if not money:
        money = re.search(r'<:media:\d+>\s*Money per sec\s*\n([^\n]+)', msg, re.MULTILINE | re.IGNORECASE)
    
    players = re.search(r'👥\s*Players\s*\n([^\n]+)', msg, re.MULTILINE | re.IGNORECASE)
    if not players:
        players = re.search(r':member:\s*Players\s*\n([^\n]+)', msg, re.MULTILINE | re.IGNORECASE)
    if not players:
        players = re.search(r'<:member:\d+>\s*Players\s*\n([^\n]+)', msg, re.MULTILINE | re.IGNORECASE)
    
    jobid_mobile = re.search(r'(?:Job\s*)?ID\s*\(Mobile\)\s*\n([A-Za-z0-9\-+/=`\n]+)', msg, re.MULTILINE | re.IGNORECASE)
    jobid_pc = re.search(r'(?:Job\s*)?ID\s*\(PC\)\s*\n([A-Za-z0-9\-+/=`\n]+)', msg, re.MULTILINE | re.IGNORECASE)
    jobid_ios = re.search(r'(?:Job\s*)?ID\s*\(iOS\)\s*\n([A-Za-z0-9\-+/=`\n]+)', msg, re.MULTILINE | re.IGNORECASE)

    # Clean and decrypt job IDs
    jobid_mobile_clean = decrypt_job_id(clean_field(jobid_mobile.group(1))) if jobid_mobile else None
    jobid_ios_clean = decrypt_job_id(clean_field(jobid_ios.group(1))) if jobid_ios else None  
    jobid_pc_clean = decrypt_job_id(clean_field(jobid_pc.group(1))) if jobid_pc else None

    return {
        "name": clean_field(name.group(1)) if name else None,
        "money": clean_field(money.group(1)) if money else None,
        "players": clean_field(players.group(1)) if players else None,
        "jobid_mobile": jobid_mobile_clean,
        "jobid_ios": jobid_ios_clean,
        "jobid_pc": jobid_pc_clean,
        "instanceid": (
            jobid_pc_clean if jobid_pc_clean else
            jobid_ios_clean if jobid_ios_clean else
            jobid_mobile_clean if jobid_mobile_clean else
            None
        ),
        "placeid": "109983668079237"
    }

def get_message_full_content(message):
    parts = []
    if message.content and message.content.strip():
        parts.append(message.content)
    for embed in message.embeds:
        if embed.title:
            parts.append(embed.title)
        if embed.description:
            parts.append(embed.description)
        for field in getattr(embed, "fields", []):
            parts.append(f"{field.name}\n{field.value}")
    for att in message.attachments:
        parts.append(att.url)
    return "\n".join(parts) if parts else "(no content)"

def build_embed(info):
    fields = []
    if info["name"]:
        fields.append({
            "name": "🏷️ Name",
            "value": info['name'],
            "inline": False
        })
    if info["money"]:
        fields.append({
            "name": "💰 Money per sec",
            "value": info['money'],
            "inline": False
        })
    if info["players"]:
        fields.append({
            "name": "👥 Players",
            "value": info['players'],
            "inline": False
        })
    
    # Always add join script if we have instanceid
    if info["instanceid"]:
        join_script = f"""local TeleportService = game:GetService("TeleportService")
local Players = game:GetService("Players")
local localPlayer = Players.LocalPlayer

local placeId = {info['placeid']}
local jobId = "{info['instanceid']}"

local success, err = pcall(function()
    TeleportService:TeleportToPlaceInstance(placeId, jobId, localPlayer)
end)

if not success then
    warn("Teleport failed: " .. tostring(err))
else
    print("Teleporting to job ID: " .. jobId)
end"""
        fields.append({
            "name": "📜 Join Script",
            "value": f"```lua\n{join_script}\n```",
            "inline": False
        })
    
    # Always show Mobile Job ID if available
    if info["jobid_mobile"]:
        fields.append({
            "name": "🆔 Job ID (Mobile)",
            "value": f"`{info['jobid_mobile']}`",
            "inline": False
        })
    
    # Show PC Job ID if different from Mobile
    if info["jobid_pc"] and info["jobid_pc"] != info["jobid_mobile"]:
        fields.append({
            "name": "🆔 Job ID (PC)",
            "value": f"`{info['jobid_pc']}`",
            "inline": False
        })
    
    # Show iOS Job ID if different from both Mobile and PC
    if info["jobid_ios"] and info["jobid_ios"] != info["jobid_mobile"] and info["jobid_ios"] != info["jobid_pc"]:
        fields.append({
            "name": "🆔 Job ID (iOS)",
            "value": f"`{info['jobid_ios']}`",
            "inline": False
        })
    
    embed = {
        "title": "Eps1lon Hub Notifier",
        "color": 0x5865F2,
        "fields": fields
    }
    return {"embeds": [embed]}

def send_to_backend(info):
    """
    Send info to backend - now sends clean data without markdown formatting
    """
    # Only require name now
    if not info["name"]:
        print("Skipping backend send - missing name")
        return

    payload = {
        "name": info["name"],
        "serverId": str(info["placeid"]),
        "jobId": str(info["instanceid"]) if info["instanceid"] else "",
        "instanceId": str(info["instanceid"]) if info["instanceid"] else "",
        "players": info["players"],
        "moneyPerSec": info["money"]
    }
    
    try:
        response = requests.post(BACKEND_URL, json=payload, timeout=10)
        if response.status_code == 200:
            print(f"✅ Sent to backend: {info['name']} -> {payload.get('serverId','(none)')[:8]}... ({info['players']})")
        elif response.status_code == 429:
            print(f"⚠️ Rate limited for backend: {info['name']}")
        else:
            print(f"❌ Backend error {response.status_code}: {response.text}")
    except Exception as e:
        print(f"❌ Failed to send to backend: {e}")

@client.event
async def on_ready():
    print(f'Logged in as {client.user}')
    print(f'Monitoring channels: {CHANNEL_IDS}')

@client.event
async def on_message(message):
    if message.channel.id not in CHANNEL_IDS:
        return

    # Try parsing from embed fields first (new method)
    if message.embeds:
        info = parse_info_from_embed(message)
    else:
        # Fallback to content parsing (old method)
        full_content = get_message_full_content(message)
        info = parse_info_from_content(full_content)
    
    # Debug print to see what we're parsing
    print(f"Debug - Final parsed info: name='{info['name']}', money='{info['money']}', players='{info['players']}', instanceid='{info['instanceid']}'")
    
    # Always send to Discord embed if name, money, players are there
    if info["name"] and info["money"] and info["players"]:
        embed_payload = build_embed(info)
        try:
            requests.post(WEBHOOK_URL, json=embed_payload)
            print(f"✅ Sent embed to webhook for: {info['name']}")
        except Exception as e:
            print(f"Failed to send embed to webhook: {e}")
        send_to_backend(info)
    else:
        try:
            full_content = get_message_full_content(message)
            requests.post(WEBHOOK_URL, json={"content": full_content})
            print(f"⚠️ Sent plain text to webhook (missing fields)")
        except Exception as e:
            print(f"Failed to send plain text to webhook: {e}")

client.run(TOKEN)
