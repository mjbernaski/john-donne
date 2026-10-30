"""Account voice discovery and a bounded, cached Faust audition."""
import hashlib
import io
import json
from pathlib import Path
import re
import threading
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import wave

API = 'https://api.elevenlabs.io'
_catalog = None
_catalog_at = 0
_lock = threading.Lock()


def api_request(key, path, payload=None):
    if not key:
        raise ValueError('The server needs an ElevenLabs API key in .env.')
    request = Request(API + path, data=None if payload is None else json.dumps(payload).encode(),
                      headers={'xi-api-key': key, 'Content-Type': 'application/json'})
    try:
        return urlopen(request, timeout=120)
    except HTTPError as error:
        try:
            detail = json.loads(error.read()).get('detail', {})
        except (ValueError, OSError):
            detail = {}
        if isinstance(detail, dict) and detail.get('status') == 'missing_permissions':
            message = str(detail.get('message', 'The API key is missing a required permission.'))
            message = message.replace(key, '[redacted]')
            raise ValueError(message + ' Enable this permission on the existing ElevenLabs API key.') from None
        if error.code == 401:
            raise ValueError('ElevenLabs rejected the server API key (401 Unauthorized). Update ELEVENLABS_API_KEY in .env and restart the server.') from None
        if error.code == 403:
            raise ValueError('ElevenLabs denied this request. Check the API key permissions and your plan.') from None
        raise ValueError(f'ElevenLabs returned HTTP {error.code}. No automatic retry was made.') from None


def catalog(key):
    global _catalog, _catalog_at
    with _lock:
        if _catalog is not None and time.time() - _catalog_at < 300:
            return _catalog
        voices = []
        token = None
        for _ in range(30):
            path = '/v2/voices?page_size=100&include_total_count=true'
            if token:
                from urllib.parse import quote
                path += '&next_page_token=' + quote(token, safe='')
            with api_request(key, path) as response:
                data = json.load(response)
            for v in data.get('voices', []):
                voice_id = v.get('voice_id', '')
                if not re.fullmatch(r'[A-Za-z0-9_-]{10,100}', voice_id): continue
                sharing = v.get('sharing') or {}
                voices.append(dict(id=voice_id, name=v.get('name', voice_id),
                                   description=v.get('description') or '', labels=v.get('labels') or {},
                                   previewUrl=v.get('preview_url'), category=v.get('category', ''),
                                   rate=sharing.get('rate')))
            token = data.get('next_page_token') if data.get('has_more') else None
            if not token: break
        with api_request(key, '/v1/models') as response:
            models = [{ 'id': m['model_id'], 'name': m.get('name', m['model_id']) }
                      for m in json.load(response) if m.get('can_do_text_to_speech')]
        _catalog = dict(voices=voices, models=models)
        _catalog_at = time.time()
        return _catalog


def resolve_voice(key, value):
    if not value.startswith('eleven:'): return None
    voice_id = value.removeprefix('eleven:')
    return voice_id if any(v['id'] == voice_id for v in catalog(key)['voices']) else None


def scene(base):
    entries = json.loads((base / 'poems-goethe-faust.json').read_text())
    selected = next(e for e in entries if e['title'] == 'Scene IV · The Study')
    chunks = re.split(r'\n\n(FAUST|MEPHISTOPHELES)\n\n', selected['content'])
    turns = []
    for i in range(1, len(chunks), 2):
        text = chunks[i + 1].strip()
        # A complete opening exchange, ending before Faust's long response.
        if len(turns) == 6: break
        turns.append(dict(speaker=chunks[i], text=text))
    if len(turns) != 6 or sum(len(t['text']) for t in turns) > 1800:
        raise ValueError('The comparison excerpt failed its length check.')
    return dict(title='The Study · opening exchange', sourceUrl=selected['sourceUrl'], turns=turns,
                characters=sum(len(t['text']) for t in turns))


def audition(base, key, payload):
    """Only the fixed excerpt can be generated; reuse matching saved samples."""
    data = catalog(key)
    model = str(payload.get('model', ''))
    if model != 'eleven_flash_v2_5' and not re.fullmatch(r'eleven_v4(?:_[a-z0-9]+)*', model):
        raise ValueError('Choose Flash or an available Eleven v4 model.')
    if model not in {m['id'] for m in data['models']}:
        raise ValueError('This model is not available to the configured account.')
    available = {v['id']: v for v in data['voices']}
    cast = payload.get('cast', {})
    if not isinstance(cast, dict) or set(cast) != {'FAUST', 'MEPHISTOPHELES'} or any(v not in available for v in cast.values()):
        raise ValueError('Select two voices from the account catalog.')
    excerpt = scene(base)
    identity = json.dumps(dict(model=model, cast=cast, turns=excerpt['turns']), sort_keys=True)
    stamp = hashlib.sha256(identity.encode()).hexdigest()
    output = base / 'faust-comparison' / (stamp + '.wav')
    output.parent.mkdir(exist_ok=True)
    with _lock:
        reused = output.exists()
        if not reused:
            # Save individual Flash turns so a later failure does not charge for them again.
            if model == 'eleven_flash_v2_5':
                chunks = []
                for turn in excerpt['turns']:
                    body = dict(text=turn['text'], voice=cast[turn['speaker']], model=model)
                    turn_key = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
                    saved = output.parent / (turn_key + '.pcm')
                    if saved.exists(): pcm = saved.read_bytes()
                    else:
                        with api_request(key, f'/v1/text-to-speech/{body["voice"]}?output_format=pcm_24000',
                                         dict(text=body['text'], model_id=model)) as response: pcm = response.read()
                        if not pcm or len(pcm) % 2: raise ValueError('ElevenLabs returned incomplete audio.')
                        saved.write_bytes(pcm)
                    chunks.append(pcm)
                pcm = b''.join(chunks)
            else:
                inputs = [dict(text=t['text'], voice_id=cast[t['speaker']]) for t in excerpt['turns']]
                with api_request(key, '/v1/text-to-dialogue?output_format=pcm_24000',
                                 dict(inputs=inputs, model_id=model)) as response: pcm = response.read()
            if not pcm or len(pcm) % 2: raise ValueError('ElevenLabs returned incomplete audio.')
            audio = io.BytesIO()
            with wave.open(audio, 'wb') as wav:
                wav.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
                wav.writeframes(pcm)
            output.write_bytes(audio.getvalue())
            output.with_suffix('.json').write_text(json.dumps(dict(model=model, cast=cast, excerpt=excerpt), ensure_ascii=False, indent=2))
    return dict(url='/faust-comparison/' + output.name, reused=reused, model=model)
