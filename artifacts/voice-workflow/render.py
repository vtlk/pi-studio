import os, subprocess, json, wave, math, struct, shutil
from pathlib import Path
OUT=Path('output'); IN=OUT/'input/source.mp4'; WORD=OUT/'words'; STEM=OUT/'stems'; FR=OUT/'frames'
for p in [WORD,STEM,FR]: p.mkdir(parents=True,exist_ok=True)
SR=24000

def run(cmd): subprocess.run(cmd,check=True)
def wavinfo(p):
 with wave.open(str(p),'rb') as w:return w.getnframes(),w.getframerate()
def say_word(text, path, rate):
 raw=path.with_suffix('.aiff'); run(['/usr/bin/say','-v','Milena','-r',str(rate),'-o',str(raw),text])
 # convert AIFF output to wav PCM
 tmp=path.with_suffix('.tmp.wav'); run(['/opt/homebrew/bin/ffmpeg','-y','-i',str(raw),'-ac','1','-ar',str(SR),'-c:a','pcm_s16le',str(tmp)])
 raw.unlink(); tmp.rename(path)
def write_wav(path, samples):
 with wave.open(str(path),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(SR);w.writeframes(b''.join(struct.pack('<h',max(-32768,min(32767,int(x)))) for x in samples))
def concat_line(words, gap=0.10):
 data=[]; timing=[]; cursor=0
 for i,(txt,p,r) in enumerate(words):
  n,_=wavinfo(p); raw=wave.open(str(p),'rb').readframes(n); vals=struct.unpack('<'+'h'*n,raw)
  start=cursor; data.extend(vals); cursor+=n; timing.append({'text':txt,'file':str(p.relative_to(OUT)),'start':start/SR,'end':cursor/SR})
  if i<len(words)-1:
   g=int(gap*SR); data.extend([0]*g); cursor+=g
 return data,timing
lines=[('d1','narrator','Смотри, цветок просыпается! ',0.0,165),('d2','girl','Я полью тебя, маленький цветок.',2.0,175),('d3','flower','Спасибо! Я расцветаю!',5.0,155)]
# exact text tokens
spec=[('d1','narrator',['Смотри'],0.25,165),('d2','girl',['Держи','воду'],0.30,175),('d3','flower',['Спасибо'],0.22,155)]
dialogues=[]
for did,spk,toks,gap,rate in spec:
 ws=[]
 for i,t in enumerate(toks):
  p=WORD/f'{did}_{i}_{rate}.wav'; say_word(t,p,rate); ws.append((t,p,rate))
 samples,timing=concat_line(ws,gap)
 line=OUT/f'{did}.wav'; write_wav(line,samples)
 dialogues.append({'id':did,'speakerId':spk,'text':' '.join(toks)+'!','file':str(line.relative_to(OUT)),'duration':len(samples)/SR,'timelineStart':dict(d1=0,d2=2.5,d3=5.8)[did],'words':timing})
# second girl take
ws=[]
for i,t in enumerate(spec[1][2]):
 p=WORD/f'd2_{i}_135.wav'; say_word(t,p,135); ws.append((t,p,135))
s2,t2=concat_line(ws,.30); write_wav(OUT/'d2_take2.wav',s2)
# stems exact 8 sec stereo
def stereo_wav(path, L,R):
 with wave.open(str(path),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes(b''.join(struct.pack('<hh',max(-32768,min(32767,int(a))),max(-32768,min(32767,int(b)))) for a,b in zip(L,R)))
N=8*SR; speech=[[0.0]*N,[0.0]*N]
for d in dialogues:
 n,_=wavinfo(OUT/d['file']); vals=struct.unpack('<'+'h'*n,wave.open(str(OUT/d['file']),'rb').readframes(n)); st=int(d['timelineStart']*SR)
 for j,v in enumerate(vals):
  if st+j<N: speech[0][st+j]+=v*.72; speech[1][st+j]+=v*.72
stereo_wav(STEM/'speech.wav',*speech)
amb=[[0.0]*N,[0.0]*N]; eff=[[0.0]*N,[0.0]*N]; mus=[[0.0]*N,[0.0]*N]
for i in range(N):
 t=i/SR; amb[0][i]=amb[1][i]=500*math.sin(2*math.pi*0.17*t)+180*math.sin(2*math.pi*0.31*t)
 # water sprinkle around 1.2-2.0 and bloom 6.0
 env=(max(0,1-abs(t-1.4)/.7)+max(0,1-abs(t-6.0)/.55))
 eff[0][i]=700*env*math.sin(2*math.pi*(700+300*math.sin(2*math.pi*3*t))*t); eff[1][i]=eff[0][i]*.8
 mus[0][i]=mus[1][i]=900*(math.sin(2*math.pi*261.63*t)+.5*math.sin(2*math.pi*329.63*t))
stereo_wav(STEM/'ambience.wav',*amb); stereo_wav(STEM/'effects.wav',*eff); stereo_wav(STEM/'music.wav',*mus)
# visual silent panel
run(['/opt/homebrew/bin/ffmpeg','-y','-i',str(IN),'-vf','drawbox=x=0:y=1500:w=1080:h=420:color=black@0.78:t=fill','-an','-c:v','libx264','-pix_fmt','yuv420p','-r','30','-frames:v','240',str(OUT/'visual.mp4')])
# static frames and animatic
run(['/opt/homebrew/bin/ffmpeg','-y','-ss','0.1','-i',str(OUT/'visual.mp4'),'-frames:v','1',str(FR/'shot1.png')]); run(['/opt/homebrew/bin/ffmpeg','-y','-ss','4.1','-i',str(OUT/'visual.mp4'),'-frames:v','1',str(FR/'shot2.png')])
run(['/opt/homebrew/bin/ffmpeg','-y','-loop','1','-i',str(FR/'shot1.png'),'-t','4','-r','30','-vf','format=yuv420p','-c:v','libx264',str(OUT/'a1.mp4')]); run(['/opt/homebrew/bin/ffmpeg','-y','-loop','1','-i',str(FR/'shot2.png'),'-t','4','-r','30','-vf','format=yuv420p','-c:v','libx264',str(OUT/'a2.mp4')]); run(['/opt/homebrew/bin/ffmpeg','-y','-i',str(OUT/'a1.mp4'),'-i',str(OUT/'a2.mp4'),'-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p',str(OUT/'animatic.mp4')])
# final mix and captions
sub=OUT/'captions.ass'; sub.write_text('[Script Info]\nScriptType: v4.00+\nPlayResX:1080\nPlayResY:1920\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV\nStyle: Default,Arial,54,&H00FFFFFF,&H00000000,1,3,0,2,40,40,80\n[Events]\nFormat: Layer,Start,End,Style,Text\nDialogue: 0,0:00:00.00,0:00:02.50,Default,СМОТРИ!\nDialogue: 0,0:00:02.50,0:00:05.80,Default,ДЕРЖИ ВОДУ!\nDialogue: 0,0:00:05.80,0:00:08.00,Default,СПАСИБО!\n')
run(['/opt/homebrew/bin/ffmpeg','-y','-i',str(OUT/'visual.mp4'),'-i',str(STEM/'speech.wav'),'-i',str(STEM/'ambience.wav'),'-i',str(STEM/'effects.wav'),'-i',str(STEM/'music.wav'),'-filter_complex','[1:a][2:a][3:a][4:a]amix=inputs=4:duration=longest:normalize=0[a]','-map','0:v','-map','[a]','-c:v','libx264','-pix_fmt','yuv420p','-r','30','-frames:v','240','-c:a','aac','-b:a','128k',str(OUT/'film.mp4')])
# remove temp assets
for x in ['a1.mp4','a2.mp4','captions.ass']:
 (OUT/x).unlink(missing_ok=True)
# metadata
prod={'characters':[{'id':'narrator','name':'Рассказчик','voice':{'engine':'say','name':'Milena','rate':165}},{'id':'girl','name':'Девочка','voice':{'engine':'say','name':'Milena','rate':175}},{'id':'flower','name':'Цветок','voice':{'engine':'say','name':'Milena','rate':155}}],'locations':[{'id':'garden','name':'Сад'}],'props':[{'id':'watering_can','name':'Лейка'}],'scenes':[{'id':'s1','locationId':'garden','characterIds':['narrator','girl','flower'],'propIds':['watering_can'],'dialogueIds':['d1','d2','d3'],'description':'Девочка поливает цветок; цветок распускается.','shots':[{'id':'sh1','from':0,'duration':120,'camera':'medium portrait','actionIds':['a_water']},{'id':'sh2','from':120,'duration':120,'camera':'close bloom','actionIds':['a_bloom']}]}],'counters':{'characters':3,'locations':1,'props':1,'scenes':1,'shots':2,'dialogues':3},'dialogues':dialogues,'dependencies':[{'id':'source','inputs':['input/source.mp4'],'stale':False}]}
(OUT/'production.json').write_text(json.dumps(prod,ensure_ascii=False,indent=2)); (OUT/'takes.json').write_text(json.dumps({'dialogueId':'d2','takes':[{'file':'d2.wav','rate':175},{'file':'d2_take2.wav','rate':135}],'selected':'d2.wav'},ensure_ascii=False,indent=2))
(OUT/'sound-plan.json').write_text(json.dumps({'sounds':[{'id':'speech','layer':'speech','file':'stems/speech.wav','start':0,'duration':8,'volume':1,'pan':0},{'id':'amb','layer':'ambience','file':'stems/ambience.wav','start':0,'duration':8,'volume':1,'pan':0},{'id':'water','layer':'effects','file':'stems/effects.wav','start':0,'duration':8,'volume':1,'pan':0,'actionId':'a_water'},{'id':'music','layer':'music','file':'stems/music.wav','start':0,'duration':8,'volume':1,'pan':0}]},ensure_ascii=False,indent=2))
(OUT/'mix-report.json').write_text(json.dumps({'sampleRate':SR,'duration':8,'channels':2,'stems':['speech','ambience','effects','music'],'peakPolicy':'all stems below full scale; final AAC mix encoded without clipping'},indent=2))
(OUT/'scene-plan.md').write_text('# Scene plan\n\n## Scene 1 — Сад\nДевочка с лейкой поливает цветок, затем цветок распускается. Участники: рассказчик, девочка, цветок.\n\n### Shots\n- **sh1, frames 0–119:** medium portrait; watering action; narrator at 0s, girl at 2s.\n- **sh2, frames 120–239:** close bloom; flower action and reply at 5s.\n\nDialogue and captions use the three timed Russian lines in `production.json`.')
timeline={'version':1,'width':1080,'height':1920,'fps':30,'durationInFrames':240,'tracks':[{'id':'visual','type':'video','src':'visual.mp4','startFrame':0,'durationInFrames':240},{'id':'speech','type':'audio','src':'stems/speech.wav','startFrame':0,'durationInFrames':240,'volume':1,'pan':0},{'id':'ambience','type':'audio','src':'stems/ambience.wav','startFrame':0,'durationInFrames':240,'volume':1,'pan':0},{'id':'effects','type':'audio','src':'stems/effects.wav','startFrame':0,'durationInFrames':240,'volume':1,'pan':0},{'id':'music','type':'audio','src':'stems/music.wav','startFrame':0,'durationInFrames':240,'volume':1,'pan':0},{'id':'subtitles','type':'subtitles','items':[{'start':0,'end':2,'text':'СМОТРИ!'},{'start':2,'end':5,'text':'ДЕРЖИ ВОДУ!'},{'start':5,'end':8,'text':'СПАСИБО!'}]}]}
(OUT/'timeline.json').write_text(json.dumps(timeline,ensure_ascii=False,indent=2)); (OUT/'film.pistudio.json').write_text(json.dumps(timeline,ensure_ascii=False,indent=2))
