#!/usr/bin/env python3
import json, subprocess, wave, math, random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).parent
FF='/opt/homebrew/bin/ffmpeg'

def run(args):
    subprocess.run(args, cwd=ROOT, check=True)

def probe(path):
    return subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=width,height,r_frame_rate,nb_frames,pix_fmt,sample_rate,channels','-of','json',str(path)],cwd=ROOT,text=True)

# 1) deterministic, quiet, audible stereo garden rustle
sr=24000; n=sr*8; rng=random.Random(24000)
white=[rng.uniform(-1,1) for _ in range(n)]
noise=[]; prev=0.0
for i,v in enumerate(white):
    prev=0.88*prev+0.12*v
    z=0.58*(0.72*v-0.28*(white[i-1] if i else 0.0))+0.42*prev
    noise.append(z*(0.72+0.28*math.sin(2*math.pi*i/sr*0.17)**2))
mx=max(abs(v) for v in noise); noise=[v/mx*0.009 for v in noise]
stereo=b''.join(int(max(-32768,min(32767,round(v*32767)))).to_bytes(2,'little',signed=True)*2 for v in noise)
with wave.open(str(ROOT/'stems/ambience.wav'),'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(stereo)

# 2) clean visual: opaque lower panel, no captions/audio
run([FF,'-y','-i','visual.mp4','-vf','drawbox=x=0:y=1500:w=1080:h=420:color=black@1.0:t=fill','-an','-c:v','libx264','-pix_fmt','yuv420p','-r','30','-frames:v','240','visual.clean.mp4'])
(ROOT/'visual.mp4').unlink(); (ROOT/'visual.clean.mp4').rename(ROOT/'visual.mp4')

# Transparent caption review PNGs
cap=ROOT/'captions'; cap.mkdir(exist_ok=True)
font='/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
if not Path(font).exists(): font='/System/Library/Fonts/Supplemental/DejaVuSans.ttf'
F=ImageFont.truetype(font,54)
for i,text in enumerate(['СМОТРИ!','РАСТИ, ЦВЕТОК!','СПАСИБО!'],1):
    im=Image.new('RGBA',(1080,1920),(0,0,0,0)); d=ImageDraw.Draw(im)
    box=d.textbbox((0,0),text,font=F,stroke_width=1); x=(1080-(box[2]-box[0]))//2
    d.text((x,1650),text,font=F,fill=(255,255,255,255),stroke_width=1,stroke_fill=(0,0,0,255))
    im.save(cap/f'caption_{i}.png')

# film: exactly one burned caption layer plus four full-gain stems
run([FF,'-y','-i','visual.mp4','-loop','1','-i','captions/caption_1.png','-loop','1','-i','captions/caption_2.png','-loop','1','-i','captions/caption_3.png',
     '-i','stems/speech.wav','-i','stems/ambience.wav','-i','stems/effects.wav','-i','stems/music.wav',
     '-filter_complex','[0:v][1:v]overlay=enable=between(t\,0\,2.5):eof_action=pass[v1];[v1][2:v]overlay=enable=between(t\,2.5\,5.8):eof_action=pass[v2];[v2][3:v]overlay=enable=between(t\,5.8\,8):eof_action=pass[v];[4:a][5:a][6:a][7:a]amix=inputs=4:duration=longest:normalize=0[a]',
     '-map','[v]','-map','[a]','-t','8','-r','30','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-ar','24000','-ac','2','-movflags','+faststart','film.mp4'])

# animatic from two held clean source shots, existing full mix
run([FF,'-y','-loop','1','-i','frames/shot1.png','-loop','1','-i','frames/shot2.png','-i','stems/speech.wav','-i','stems/ambience.wav','-i','stems/effects.wav','-i','stems/music.wav',
     '-filter_complex','[0:v]trim=duration=4,setpts=PTS-STARTPTS[a];[1:v]trim=duration=4,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0,format=yuv420p[v];[2:a][3:a][4:a][5:a]amix=inputs=4:duration=longest:normalize=0[aud]',
     '-map','[v]','-map','[aud]','-t','8','-r','30','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-ar','24000','-ac','2','-movflags','+faststart','animatic.mp4'])

# reports
mix={'version':1,'inputs':['stems/speech.wav','stems/ambience.wav','stems/effects.wav','stems/music.wav'],'normalization':'none','gains':[1,1,1,1],'output':'film.mp4'}
(ROOT/'mix-report.json').write_text(json.dumps(mix,ensure_ascii=False,indent=2)+'\n')
sp={'version':1,'sampleRate':24000,'channels':2,'durationSeconds':8,'stems':{'speech':'preserved','ambience':'deterministic band-limited garden rustle','effects':'preserved','music':'preserved'}}
(ROOT/'sound-plan.json').write_text(json.dumps(sp,ensure_ascii=False,indent=2)+'\n')
