import sys
import os
import traceback
import torch
import torchaudio

try:
    print("Importando OmniVoice...")
    from omnivoice import OmniVoice
    
    print("Carregando modelo...")
    model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="cpu")
    print("Modelo carregado!")
    
    # Generate a dummy reference WAV file (1 second of silence)
    dummy_wav_path = "dummy_ref.wav"
    sample_rate = 24000
    waveform = torch.zeros(1, sample_rate) # 1 channel, 24kHz
    import soundfile as sf
    sf.write(dummy_wav_path, waveform.squeeze().numpy(), sample_rate)
    print(f"Áudio de referência dummy criado em: {dummy_wav_path}")
    
    try:
        print("Executando model.generate...")
        audio = model.generate(
            text="Olá, este é um teste.",
            ref_audio=dummy_wav_path
        )
        print("Model.generate concluído com sucesso!")
        print(f"Resultado: type={type(audio)}, len={len(audio) if audio else 0}")
    except Exception as e:
        print("\n!!! OCORREU UM ERRO EM model.generate !!!")
        print(f"Tipo da exceção: {type(e)}")
        print(f"String da exceção: '{str(e)}'")
        print(f"Args da exceção: {e.args}")
        print("Traceback:")
        traceback.print_exc()
        
    # Cleanup dummy file
    if os.path.exists(dummy_wav_path):
        os.remove(dummy_wav_path)
        
except Exception as e:
    print("Erro geral no script:")
    traceback.print_exc()
