import os
import tempfile
import argparse
import warnings
warnings.filterwarnings("ignore")
import logging
logging.getLogger("transformers").setLevel(logging.ERROR)
try:
    from transformers.utils import logging as transformers_logging
    transformers_logging.set_verbosity_error()
except Exception:
    pass

import ssl
import sys
import torch
import numpy as np
import soundfile as sf
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# =====================================================================
# 1. SSL & Hugging Face Unverified Context Patches (Bypass SSL Errors)
# =====================================================================
ssl._create_default_https_context = ssl._create_unverified_context
os.environ['CURL_CA_BUNDLE'] = ''
os.environ['REQUESTS_CA_BUNDLE'] = ''

try:
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
except ImportError:
    pass

try:
    import httpx
    from huggingface_hub.utils._http import (
        hf_request_event_hook, 
        set_client_factory,
        async_hf_request_event_hook,
        async_hf_response_event_hook,
        set_async_client_factory
    )
    
    def unverified_client_factory() -> httpx.Client:
        return httpx.Client(
            event_hooks={"request": [hf_request_event_hook]},
            follow_redirects=True,
            timeout=None,
            verify=False
        )

    def unverified_async_client_factory() -> httpx.AsyncClient:
        return httpx.AsyncClient(
            event_hooks={
                "request": [async_hf_request_event_hook], 
                "response": [async_hf_response_event_hook]
            },
            follow_redirects=True,
            timeout=None,
            verify=False
        )

    set_client_factory(unverified_client_factory)
    set_async_client_factory(unverified_async_client_factory)
except Exception as e:
    pass

# =====================================================================
# 2. Transformers 5.x Compatibility Monkeypatches for Qwen3-TTS
# =====================================================================
import transformers.utils.generic
original_check = transformers.utils.generic.check_model_inputs
transformers.utils.generic.check_model_inputs = lambda *args, **kwargs: (lambda f: f) if not args else original_check(*args)

import transformers.generation.utils
transformers.generation.utils.GenerationMixin._validate_model_kwargs = lambda self, model_kwargs: None


from transformers import PretrainedConfig
PretrainedConfig.pad_token_id = None
PretrainedConfig.eos_token_id = None
PretrainedConfig.bos_token_id = None
PretrainedConfig.sep_token_id = None

from transformers.modeling_rope_utils import ROPE_INIT_FUNCTIONS

def custom_default_rope_parameters(config, device=None):
    base = 10000.0
    if hasattr(config, "rope_theta"):
        base = config.rope_theta
    elif hasattr(config, "rope_parameters") and config.rope_parameters is not None:
        if isinstance(config.rope_parameters, dict):
            base = config.rope_parameters.get("rope_theta", 10000.0)
    elif hasattr(config, "rope_scaling") and config.rope_scaling is not None:
        if isinstance(config.rope_scaling, dict):
            base = config.rope_scaling.get("rope_theta", 10000.0)
            
    head_dim = getattr(config, "head_dim", None)
    if head_dim is None:
        hidden_size = getattr(config, "hidden_size", None)
        num_attention_heads = getattr(config, "num_attention_heads", None)
        if hidden_size is not None and num_attention_heads is not None:
            head_dim = hidden_size // num_attention_heads
        else:
            head_dim = 128
            
    attention_factor = 1.0
    inv_freq = 1.0 / (
        base ** (torch.arange(0, head_dim, 2, dtype=torch.int64).to(device=device, dtype=torch.float) / head_dim)
    )
    return inv_freq, attention_factor

ROPE_INIT_FUNCTIONS['default'] = custom_default_rope_parameters

import transformers.masking_utils
orig_causal_mask = transformers.masking_utils.create_causal_mask
orig_sliding_mask = transformers.masking_utils.create_sliding_window_causal_mask

def patched_create_causal_mask(*args, **kwargs):
    if "input_embeds" in kwargs:
        kwargs["inputs_embeds"] = kwargs.pop("input_embeds")
    kwargs.pop("cache_position", None)
    return orig_causal_mask(*args, **kwargs)

def patched_create_sliding_window_causal_mask(*args, **kwargs):
    if "input_embeds" in kwargs:
        kwargs["inputs_embeds"] = kwargs.pop("input_embeds")
    kwargs.pop("cache_position", None)
    return orig_sliding_mask(*args, **kwargs)

transformers.masking_utils.create_causal_mask = patched_create_causal_mask
transformers.masking_utils.create_sliding_window_causal_mask = patched_create_sliding_window_causal_mask

from transformers.cache_utils import DynamicCache
orig_update = DynamicCache.update

def patched_update(self, key_states, value_states, layer_idx, cache_kwargs=None):
    if cache_kwargs is not None:
        cache_kwargs = cache_kwargs.copy()
        cache_kwargs.pop("cos", None)
        cache_kwargs.pop("sin", None)
    return orig_update(self, key_states, value_states, layer_idx, cache_kwargs)

DynamicCache.update = patched_update

from qwen_tts.core.models.modeling_qwen3_tts import Qwen3TTSTalkerModel
orig_talker_model_forward = Qwen3TTSTalkerModel.forward

def patched_talker_model_forward(self, input_ids=None, attention_mask=None, position_ids=None, *args, **kwargs):
    inputs_embeds = kwargs.get("inputs_embeds", None)
    if inputs_embeds is None and input_ids is not None:
        inputs_embeds = self.embed_tokens(input_ids)
        
    if inputs_embeds is not None and position_ids is not None:
        inputs_seq_len = inputs_embeds.shape[1]
        if position_ids.shape[-1] > inputs_seq_len:
            position_ids = position_ids[..., -inputs_seq_len:]
            
    return orig_talker_model_forward(self, input_ids, attention_mask, position_ids, *args, **kwargs)

Qwen3TTSTalkerModel.forward = patched_talker_model_forward

from qwen_tts.core.models.modeling_qwen3_tts import Qwen3TTSTalkerForConditionalGeneration
orig_talker_cond_forward = Qwen3TTSTalkerForConditionalGeneration.forward

def patched_talker_cond_forward(self, input_ids=None, attention_mask=None, position_ids=None, past_key_values=None, inputs_embeds=None, labels=None, use_cache=None, output_attentions=None, output_hidden_states=None, return_dict=None, cache_position=None, **kwargs):
    if cache_position is None:
        past_length = 0
        if past_key_values is not None:
            if isinstance(past_key_values, tuple) or isinstance(past_key_values, list):
                if len(past_key_values) > 0 and len(past_key_values[0]) > 0:
                    past_length = past_key_values[0][0].shape[2]
            elif hasattr(past_key_values, "get_seq_length"):
                past_length = past_key_values.get_seq_length()
        
        seq_length = 0
        if input_ids is not None:
            seq_length = input_ids.shape[1]
        elif inputs_embeds is not None:
            seq_length = inputs_embeds.shape[1]
            
        cache_position = torch.arange(past_length, past_length + seq_length, device=self.device)
        
    return orig_talker_cond_forward(
        self,
        input_ids=input_ids,
        attention_mask=attention_mask,
        position_ids=position_ids,
        past_key_values=past_key_values,
        inputs_embeds=inputs_embeds,
        labels=labels,
        use_cache=use_cache,
        output_attentions=output_attentions,
        output_hidden_states=output_hidden_states,
        return_dict=return_dict,
        cache_position=cache_position,
        **kwargs
    )

Qwen3TTSTalkerForConditionalGeneration.forward = patched_talker_cond_forward

# =====================================================================
# 3. FastAPI App Setup and Lazy Loaded Models Setup
# =====================================================================

app = FastAPI(title="Local Speech Server API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables for models
omnivoice_model = None
qwen3_models = {}
device = "cpu"

def cleanup_files(*paths):
    """Deletes temporary files after they have been processed and sent."""
    for path in paths:
        try:
            if path and os.path.exists(path):
                os.remove(path)
                print(f"[Cleanup] Removed temporary file: {path}")
        except Exception as e:
            print(f"[Cleanup] Error removing {path}: {e}")

@app.on_event("startup")
def load_omnivoice():
    global omnivoice_model, device
    print("--------------------------------------------------")
    print("Iniciando o servidor de Voz Local...")
    
    try:
        from omnivoice import OmniVoice
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        print(f"Dispositivo selecionado: {device.upper()}")
        
        print("Carregando o modelo 'k2-fsa/OmniVoice' (pode levar alguns minutos na primeira vez)...")
        if torch.cuda.is_available():
            omnivoice_model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map=device, dtype=torch.float16)
        else:
            omnivoice_model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map=device)
            
        print("Modelo OmniVoice carregado com sucesso!")
    except ImportError as e:
        print("\n[AVISO] OmniVoice não pôde ser importado. O servidor funcionará apenas com Qwen3-TTS se instalado.")
        print(f"Detalhe: {e}")
    except Exception as e:
        print(f"\n[ERRO] Falha ao inicializar o OmniVoice: {e}")
    print("--------------------------------------------------")

def get_qwen3_model(model_name: str):
    global qwen3_models
    if model_name not in qwen3_models:
        print(f"--------------------------------------------------")
        print(f"Carregando {model_name} na GPU (CUDA)...")
        from qwen_tts import Qwen3TTSModel
        qwen3_models[model_name] = Qwen3TTSModel.from_pretrained(
            model_name,
            device_map="cuda" if torch.cuda.is_available() else "cpu",
            dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32
        )
        print(f"Modelo {model_name} carregado com sucesso na GPU!")
        print(f"--------------------------------------------------")
    return qwen3_models[model_name]

@app.get("/health")
def health():
    return {
        "status": "ok", 
        "device": device, 
        "omnivoice_loaded": omnivoice_model is not None,
        "qwen3_loaded_models": list(qwen3_models.keys())
    }

def detect_language(text: str) -> str:
    import re
    # 1. Check for specific scripts
    if re.search(r'[\u4e00-\u9fff]', text):
        return 'chinese'
    if re.search(r'[\u3040-\u309f\u30a0-\u30ff]', text):
        return 'japanese'
    if re.search(r'[\uac00-\ud7a3]', text):
        return 'korean'
    if re.search(r'[\u0400-\u04ff]', text):
        return 'russian'
        
    # 2. Heuristics for Latin script using stop words
    words = re.findall(r'\b\w+\b', text.lower())
    if not words:
        return 'english'  # Default fallback
        
    counts = {
        'english': 0,
        'portuguese': 0,
        'spanish': 0,
        'french': 0,
        'german': 0,
        'italian': 0
    }
    
    stop_words = {
        'english': {'the', 'and', 'to', 'of', 'is', 'in', 'it', 'you', 'that', 'we', 'are', 'screwed', 'dude'},
        'portuguese': {'o', 'do', 'da', 'em', 'um', 'uma', 'de', 'que', 'não', 'para', 'com'},
        'spanish': {'el', 'la', 'de', 'que', 'en', 'los', 'las', 'con', 'para', 'como'},
        'french': {'le', 'la', 'les', 'de', 'et', 'un', 'une', 'en', 'que', 'dans', 'pour'},
        'german': {'der', 'die', 'das', 'und', 'ist', 'in', 'zu', 'den', 'von', 'mit'},
        'italian': {'il', 'la', 'di', 'che', 'in', 'un', 'una', 'per', 'con', 'i'}
    }
    
    for word in words:
        for lang, s_words in stop_words.items():
            if word in s_words:
                counts[lang] += 1
                
    max_lang = max(counts, key=counts.get)
    if counts[max_lang] > 0:
        return max_lang
        
    if re.search(r'[ãõç]', text.lower()):
        return 'portuguese'
    if re.search(r'[ñ¿¡]', text.lower()):
        return 'spanish'
    if re.search(r'[äöüß]', text.lower()):
        return 'german'
    if re.search(r'[éèàùçâêîôûëïüÿœæ]', text.lower()):
        return 'french'
        
    return 'english'

@app.post("/tts")
async def text_to_speech(
    background_tasks: BackgroundTasks,
    text: str = Form(...),
    reference_audio: UploadFile = File(None),
    instruct: str = Form(None),
    speed: float = Form(1.0),
    num_step: int = Form(32),
    guidance_scale: float = Form(2.0),
    provider: str = Form("omnivoice")
):
    ref_path = None
    out_path = None
    
    try:
        # 1. Save uploaded reference audio to a temporary file if provided
        has_ref = False
        if reference_audio and reference_audio.filename:
            audio_bytes = await reference_audio.read()
            if len(audio_bytes) > 0:
                has_ref = True
                temp_dir = tempfile.gettempdir()
                _, ext = os.path.splitext(reference_audio.filename or ".mp3")
                if not ext:
                    ext = ".mp3"
                with tempfile.NamedTemporaryFile(dir=temp_dir, delete=False, suffix=ext) as ref_file:
                    ref_file.write(audio_bytes)
                    ref_path = ref_file.name
                print(f"[TTS] Áudio de referência recebido ({len(audio_bytes)} bytes) e salvo em: {ref_path}")
        
        print(f"[TTS] Provedor selecionado: {provider.upper()}")
        print(f"[TTS] Recebido texto: '{text}'")
        print(f"[TTS] Recebida instrução: '{instruct}'")
        
        # Prepare output path
        temp_dir = tempfile.gettempdir()
        with tempfile.NamedTemporaryFile(dir=temp_dir, delete=False, suffix="_output.wav") as out_file:
            out_path = out_file.name

        # 2. Run selected provider inference
        if provider == "qwen3":
            # Normalizar instrução
            instruct_val = instruct.strip() if (instruct and instruct.strip()) else ""
            
            # Detect language
            detected_lang = detect_language(text)
            print(f"[TTS Qwen3] Detected language: '{detected_lang}'")
            
            # Calculate sensible max_new_tokens to prevent infinite generation loops when EOS is missed
            # 12Hz frame rate means 12 tokens per second of speech. 150 words/min = 2.5 words/sec -> ~5 tokens/word.
            # We allow 20 tokens per word plus 150 tokens overhead (for thinking tokens and silence).
            max_tokens = max(200, len(text.split()) * 20 + 150)
            print(f"[TTS Qwen3] Calculated max_new_tokens limit: {max_tokens}")
            
            if has_ref:
                # Voice Cloning Mode (Base Model)
                print(f"[TTS Qwen3] Iniciando Voice Cloning com Base model...")
                model_qwen = get_qwen3_model("Qwen/Qwen3-TTS-12Hz-1.7B-Base")
                
                # generate_voice_clone returns (wavs: List[np.ndarray], sr: int)
                wavs, sr = model_qwen.generate_voice_clone(
                    text=text,
                    language=detected_lang,
                    ref_audio=ref_path,
                    x_vector_only_mode=True,
                    max_new_tokens=max_tokens
                )
            else:
                # Voice Design Mode (CustomVoice Model)
                print(f"[TTS Qwen3] Iniciando Voice Design com CustomVoice model...")
                model_qwen = get_qwen3_model("Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice")
                
                # Determine speaker name
                supported_speakers = model_qwen.get_supported_speakers() or ["aiden"]
                speaker_name = supported_speakers[0] if supported_speakers else "aiden"
                
                # Try to parse speaker from instruct (e.g. "Qwen-warm: Speak softly" -> speaker="Qwen-warm", instruct="Speak softly")
                for spk in supported_speakers:
                    if instruct_val.lower().startswith(spk.lower()):
                        speaker_name = spk
                        instruct_val = instruct_val[len(spk):].lstrip(":, ")
                        break
                
                print(f"[TTS Qwen3] Usando speaker: {speaker_name}, Instrução: '{instruct_val}'")
                wavs, sr = model_qwen.generate_custom_voice(
                    text=text,
                    language=detected_lang,
                    speaker=speaker_name,
                    instruct=instruct_val if instruct_val else None,
                    max_new_tokens=max_tokens
                )
            
            raw_waveform = wavs[0]
            
        else:
            # Default to OmniVoice
            global omnivoice_model
            if omnivoice_model is None:
                raise ValueError("O modelo OmniVoice não está carregado no servidor.")
                
            instruct_val = instruct.strip() if (instruct and instruct.strip()) else None
            
            if has_ref:
                print(f"[TTS OmniVoice] Gerando áudio clonado...")
                try:
                    audio = omnivoice_model.generate(
                        text=text,
                        ref_audio=ref_path,
                        instruct=instruct_val,
                        speed=speed,
                        num_step=num_step,
                        guidance_scale=guidance_scale,
                        preprocess_prompt=True
                    )
                except ValueError as ve:
                    if "silence removal" in str(ve):
                        print("[TTS OmniVoice] Aviso: Áudio vazio após remoção de silêncio. Tentando com preprocess_prompt=False...")
                        audio = omnivoice_model.generate(
                            text=text,
                            ref_audio=ref_path,
                            instruct=instruct_val,
                            speed=speed,
                            num_step=num_step,
                            guidance_scale=guidance_scale,
                            preprocess_prompt=False
                        )
                    else:
                        raise ve
            else:
                print(f"[TTS OmniVoice] Gerando áudio via Voice Design...")
                audio = omnivoice_model.generate(
                    text=text,
                    instruct=instruct_val,
                    speed=speed,
                    num_step=num_step,
                    guidance_scale=guidance_scale
                )
            
            raw_waveform = audio[0]
            sr = 24000
            
        # 3. Save generated waveform using soundfile
        if isinstance(raw_waveform, np.ndarray):
            waveform_np = raw_waveform
        elif torch.is_tensor(raw_waveform):
            waveform_np = raw_waveform.cpu().numpy()
        else:
            waveform_np = np.array(raw_waveform)
            
        waveform_np = np.squeeze(waveform_np)
        sf.write(out_path, waveform_np, sr)
        print(f"[TTS] Áudio salvo com sucesso em: {out_path} (Sample Rate: {sr})")
        
        # 4. Schedule cleanup of temp files
        background_tasks.add_task(cleanup_files, ref_path, out_path)
        
        return FileResponse(out_path, media_type="audio/wav", filename="tts_output.wav")
        
    except Exception as e:
        import traceback
        cleanup_files(ref_path, out_path)
        print("[TTS ERRO] Erro no processamento:")
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e) or type(e).__name__})

# Pydantic model for request validation
from pydantic import BaseModel
class VideoAnalysisRequest(BaseModel):
    video_url: str
    gemini_api_key: str = ""
    openai_api_key: str = ""
    provider: str = "gemini"
    visual_analysis: bool = False
    prompt: str = ""
    local_llm_url: str = ""
    local_llm_model: str = ""

@app.post("/analyze-video")
async def analyze_video(req: VideoAnalysisRequest):
    import re
    import os
    import tempfile
    import base64
    import requests
    
    # 1. Helper to extract YouTube video ID
    def get_video_id(url: str) -> str:
        patterns = [
            r'(?:https?://)?(?:www\.)?youtube\.com/watch\?v=([^&\s]+)',
            r'(?:https?://)?(?:www\.)?youtu\.be/([^?\s]+)',
            r'(?:https?://)?(?:www\.)?youtube\.com/shorts/([^?\s]+)',
            r'(?:https?://)?(?:www\.)?youtube\.com/embed/([^?\s]+)'
        ]
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        return None

    video_id = get_video_id(req.video_url)
    if not video_id:
        return JSONResponse(status_code=400, content={"error": "Link de vídeo do YouTube inválido."})

    subtitles = None
    frames = None
    temp_video_path = None

    try:
        # Tenta obter a transcrição primeiro
        try:
            print(f"[Analyze Video] Buscando transcrição para o vídeo ID: {video_id}...")
            from youtube_transcript_api import YouTubeTranscriptApi
            # Usar HTTP client com verify=False para contornar erros de certificado SSL locais
            session = requests.Session()
            session.verify = False
            transcript_list = YouTubeTranscriptApi(http_client=session).fetch(video_id, languages=['pt', 'en', 'es', 'fr'])
            subtitles = "\n".join([item.text for item in transcript_list])
            print("[Analyze Video] Transcrição extraída com sucesso!")
        except Exception as e:
            print(f"[Analyze Video] Não foi possível extrair legendas: {e}")

        # Se for solicitado análise visual e o provedor for Gemini, baixa e extrai frames
        if req.visual_analysis and req.provider == "gemini":
            if not req.gemini_api_key.strip():
                return JSONResponse(status_code=400, content={"error": "A API Key do Gemini é obrigatória para a análise visual."})
                
            print(f"[Analyze Video] Iniciando download do vídeo via yt-dlp...")
            import yt_dlp
            temp_dir = tempfile.gettempdir()
            ydl_opts = {
                'format': 'worstvideo[ext=mp4]/worst',
                'outtmpl': os.path.join(temp_dir, f'{video_id}_temp.%(ext)s'),
                'noplaylist': True,
                'quiet': True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(req.video_url, download=True)
                temp_video_path = ydl.prepare_filename(info)
                
            print(f"[Analyze Video] Vídeo baixado com sucesso em: {temp_video_path}")
            
            # Extrai frames usando OpenCV
            import cv2
            cap = cv2.VideoCapture(temp_video_path)
            if not cap.isOpened():
                raise ValueError(f"Não foi possível abrir o arquivo de vídeo baixado.")
                
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            duration = total_frames / fps if fps > 0 else 0
            
            # Amostrar no máximo 30 frames
            max_frames = 30
            sample_interval_sec = max(1.0, duration / max_frames)
            sample_interval_frames = int(sample_interval_sec * fps) if fps > 0 else 30
            
            frames = []
            count = 0
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break
                if count % sample_interval_frames == 0:
                    h, w = frame.shape[:2]
                    new_w = 320
                    new_h = int(h * (new_w / w))
                    resized = cv2.resize(frame, (new_w, new_h))
                    
                    _, buffer = cv2.imencode('.jpg', resized)
                    b64_str = base64.b64encode(buffer).decode('utf-8')
                    frames.append(b64_str)
                    
                    if len(frames) >= max_frames:
                        break
                count += 1
            cap.release()
            print(f"[Analyze Video] {len(frames)} frames extraídos.")

        # Limpar arquivo de vídeo temporário imediatamente
        if temp_video_path and os.path.exists(temp_video_path):
            try:
                os.remove(temp_video_path)
                print(f"[Analyze Video] Arquivo temporário de vídeo removido: {temp_video_path}")
            except Exception as e:
                print(f"[Analyze Video] Erro ao remover arquivo temporário: {e}")

        # Se não temos nem transcrição nem frames, não há o que analisar
        if not subtitles and not frames:
            return JSONResponse(status_code=400, content={"error": "Não foi possível obter legendas nem conteúdo visual para o vídeo."})

        # Set up LLM parameters
        system_prompt = """Você é um roteirista profissional e assistente de escrita para um gerador de Chat Stories em formato de vídeo (estilo conversa de WhatsApp/iMessage).
Esta é uma análise puramente educacional, ficcional e criativa de uma obra de ficção audiovisual para fins de estudo de roteirização.
Sua tarefa é analisar o vídeo do YouTube (fornecido através de imagens sequenciais de frames ou transcrição de legenda) e adaptá-lo/recriá-lo no formato de um Chat Story de WhatsApp/iMessage.

O roteiro gerado DEVE seguir EXATAMENTE o seguinte formato textual:
- Comece com o cabeçalho do tema na primeira linha:
- iMessage: [Nome do Contato ou do Grupo]
(Ou "- WhatsApp: [Nome]")

- As falas seguintes devem ter a estrutura:
[Lado]: [NomePersonagem]> [Mensagem]

Onde [Lado] é:
1 - Lado esquerdo (personagem remoto/outro participante)
2 - Lado direito (personagem autor/dono do celular)

Exemplo de formato válido:
- iMessage: Lucas
1: Lucas> Oi Amor, tudo bem?
2: Ana> Oi! Tudo sim, e com você?
1: Lucas> Estou ótimo. Onde você está?

Você deve:
1. Identificar quem são as pessoas/personagens principais e o conflito ou história do vídeo.
2. Adaptar essa história para um formato de diálogo de chat dinâmico e interessante, adequado para prender a atenção do público em vídeos de redes sociais.
3. Se for fornecido frames do vídeo, analise o que acontece visualmente e crie as falas correspondentes (por exemplo, descrevendo as reações ou ações dos participantes).
4. Retorne APENAS o roteiro formatado. Não escreva nenhuma introdução, explicação ou consideração antes ou depois do roteiro.
5. Se o usuário forneceu orientações adicionais, siga-as estritamente ao criar o roteiro.
6. NUNCA inicie ou estruture a resposta com títulos ou cabeçalhos em Markdown (por exemplo, NÃO use '#', '##' ou '###' como '## Roteiro'). Comece a resposta diretamente com o cabeçalho do tema (ex: - iMessage: Lucas)."""

        user_prompt = ""
        if subtitles:
            user_prompt += f"Legenda/Transcrição do Vídeo:\n{subtitles}\n\n"
        if frames:
            user_prompt += f"Frames sequenciais do vídeo fornecidos como imagens anexadas.\n\n"
        if req.prompt.strip():
            user_prompt += f"Orientações adicionais do usuário:\n{req.prompt}\n\n"
            
        user_prompt += "Gere a história em formato de conversa de chat (mínimo de 20 falas) seguindo as regras e o formato exigidos."

        generated_text = ""

        # Enviar requisição
        import json
        if req.provider == "gemini":
            apiKey = req.gemini_api_key
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={apiKey}"
            
            parts = []
            if frames:
                for b64_img in frames:
                    parts.append({
                        "inlineData": {
                            "mimeType": "image/jpeg",
                            "data": b64_img
                        }
                    })
            parts.append({"text": user_prompt})
            
            payload = {
                "contents": [{"role": "user", "parts": parts}],
                "systemInstruction": {"parts": [{"text": system_prompt}]},
                "safetySettings": [
                    {
                        "category": "HARM_CATEGORY_HARASSMENT",
                        "threshold": "BLOCK_NONE"
                    },
                    {
                        "category": "HARM_CATEGORY_HATE_SPEECH",
                        "threshold": "BLOCK_NONE"
                    },
                    {
                        "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                        "threshold": "BLOCK_NONE"
                    },
                    {
                        "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                        "threshold": "BLOCK_NONE"
                    }
                ]
            }
            
            headers = {"Content-Type": "application/json"}
            response = requests.post(url, headers=headers, json=payload, verify=False)
            print(f"[Analyze Video] Gemini API Response Status: {response.status_code}")
            if response.status_code != 200:
                print(f"[Analyze Video] Gemini API Error Body: {response.text}")
                raise ValueError(f"Erro na API do Gemini: {response.text}")
                
            data = response.json()
            print(f"[Analyze Video] Gemini Response JSON keys: {list(data.keys())}")
            
            candidates = data.get("candidates", [])
            if candidates:
                print(f"[Analyze Video] Gemini candidates count: {len(candidates)}")
                first_cand = candidates[0]
                print(f"[Analyze Video] Finish Reason: {first_cand.get('finishReason')}")
                parts_result = first_cand.get("content", {}).get("parts", [])
                if parts_result:
                    generated_text = parts_result[0].get("text", "")
                    print(f"[Analyze Video] Generated text length: {len(generated_text)}")
                else:
                    print("[Analyze Video] No parts found in candidates[0].content")
            else:
                print(f"[Analyze Video] No candidates found. Prompt Feedback: {data.get('promptFeedback')}")
            
        elif req.provider == "openai":
            # OpenAI (text only)
            apiKey = req.openai_api_key
            url = "https://api.openai.com/v1/chat/completions"
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {apiKey}"
            }
            payload = {
                "model": "gpt-4o-mini",
                "messages": [
                    {"role": "system", content: system_prompt},
                    {"role": "user", content: user_prompt}
                ]
            }
            response = requests.post(url, headers=headers, json=payload, verify=False)
            print(f"[Analyze Video] OpenAI API Response Status: {response.status_code}")
            if response.status_code != 200:
                print(f"[Analyze Video] OpenAI API Error Body: {response.text}")
                raise ValueError(f"Erro na API da OpenAI: {response.text}")
                
            data = response.json()
            choices = data.get("choices", [])
            if choices:
                generated_text = choices[0].get("message", {}).get("content", "")
                print(f"[Analyze Video] OpenAI Generated text length: {len(generated_text)}")
            else:
                print("[Analyze Video] No choices returned from OpenAI.")
        else:
            # Local LLM (text only)
            url = f"{req.local_llm_url.rstrip('/')}/chat/completions"
            headers = {
                "Content-Type": "application/json",
                "Authorization": "Bearer local-key-not-needed"
            }
            payload = {
                "model": req.local_llm_model or "local-model",
                "messages": [
                    {"role": "user", "content": f"{system_prompt}\n\n{user_prompt}"}
                ]
            }
            response = requests.post(url, headers=headers, json=payload, verify=False)
            print(f"[Analyze Video] Local LLM API Response Status: {response.status_code}")
            if response.status_code != 200:
                print(f"[Analyze Video] Local LLM API Error Body: {response.text}")
                raise ValueError(f"Erro na API do Modelo Local: {response.text}")
                
            data = response.json()
            choices = data.get("choices", [])
            if choices:
                generated_text = choices[0].get("message", {}).get("content", "")
                print(f"[Analyze Video] Local LLM Generated text length: {len(generated_text)}")
            else:
                print("[Analyze Video] No choices returned from Local LLM.")

        # Clean text
        generated_text = generated_text.strip()
        
        # Strip markdown syntax
        if generated_text.startswith("```"):
            # remove first line
            lines = generated_text.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            generated_text = "\n".join(lines).strip()
        
        return {"script": generated_text}

    except Exception as e:
        # Garante a limpeza do arquivo temporário em caso de erro
        if temp_video_path and os.path.exists(temp_video_path):
            try:
                os.remove(temp_video_path)
            except Exception:
                pass
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": f"Erro ao analisar o vídeo: {str(e)}"})

if __name__ == "__main__":
    import uvicorn
    parser = argparse.ArgumentParser(description="Local Speech Server API Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host address to bind to")
    parser.add_argument("--port", type=int, default=8000, help="Port to run the server on")
    args = parser.parse_args()
    
    uvicorn.run(app, host=args.host, port=args.port)
