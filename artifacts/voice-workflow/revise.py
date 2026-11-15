import json,hashlib,wave,struct,subprocess
from pathlib import Path
O=Path(__file__).parent; W=O/'words'; SR=24000
run=lambda c:subprocess.run(c,check=True)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def say(t,p,rate):
 a=p.with_suffix('.aiff');run(['/usr/bin/say','-v','Milena','-r',str(rate),'-o',str(a),t]);run(['/opt/homebrew/bin/ffmpeg','-y','-i',str(a),'-ac','1','-ar',str(SR),'-c:a','pcm_s16le',str(p)]);a.unlink()
def vals(p):
 with wave.open(str(p),'rb') as w:return struct.unpack('<'+'h'*w.getnframes(),w.readframes(w.getnframes()))
def build(tokens,rate):
 out=[]; timing=[];cur=0
 for i,t in enumerate(tokens):
  p=W/f'revision_d2_{i}_{rate}.wav';say(t,p,rate);v=vals(p);out+=list(v);timing.append({'text':t,'file':str(p.relative_to(O)),'start':cur/SR,'end':(cur+len(v))/SR});cur+=len(v)
  if i<len(tokens)-1: g=int(.3*SR);out += [0]*g;cur+=g
 return out,timing
old={'d2.wav':sha(O/'d2.wav'),'d2_take2.wav':sha(O/'d2_take2.wav'),'speech':sha(O/'stems/speech.wav')}
new,timing=build(['Расти','цветок'],175)
with wave.open(str(O/'revision_d2.wav'),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(SR);w.writeframes(b''.join(struct.pack('<h',x) for x in new))
p=json.load(open(O/'production.json'))
for d in p['dialogues']:
 if d['id']=='d2':d.update(text='Расти, цветок!',file='revision_d2.wav',duration=len(new)/SR,words=timing)
for s in p['scenes']:s['propIds']=[]
open(O/'production.json','w').write(json.dumps(p,ensure_ascii=False,indent=2))
t={'dialogueId':'d2','takes':[{'file':'d2.wav','rate':175},{'file':'d2_take2.wav','rate':135},{'file':'revision_d2.wav','rate':175}],'selected':'revision_d2.wav'}
open(O/'takes.json','w').write(json.dumps(t,ensure_ascii=False,indent=2))
# rebuild speech only
N=8*SR; L=[0.0]*N;R=[0.0]*N
for did,st,path in [('d1',0,'d1.wav'),('d2',2.5,'revision_d2.wav'),('d3',5.8,'d3.wav')]:
 v=vals(O/path);off=int(st*SR)
 for i,x in enumerate(v):
  if off+i<N:L[off+i]+=x*.72;R[off+i]+=x*.72
with wave.open(str(O/'stems/speech.wav'),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes(b''.join(struct.pack('<hh',int(a),int(b)) for a,b in zip(L,R)))
# regenerate animatic from existing static frames
run(['/opt/homebrew/bin/ffmpeg','-y','-loop','1','-i',str(O/'frames/shot1.png'),'-t','4','-r','30','-vf','format=yuv420p','-c:v','libx264',str(O/'_a1.mp4')]);run(['/opt/homebrew/bin/ffmpeg','-y','-loop','1','-i',str(O/'frames/shot2.png'),'-t','4','-r','30','-vf','format=yuv420p','-c:v','libx264',str(O/'_a2.mp4')]);run(['/opt/homebrew/bin/ffmpeg','-y','-i',str(O/'_a1.mp4'),'-i',str(O/'_a2.mp4'),'-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p',str(O/'animatic.mp4')]);(O/'_a1.mp4').unlink();(O/'_a2.mp4').unlink()
run(['/opt/homebrew/bin/ffmpeg','-y','-i',str(O/'visual.mp4'),'-i',str(O/'stems/speech.wav'),'-i',str(O/'stems/ambience.wav'),'-i',str(O/'stems/effects.wav'),'-i',str(O/'stems/music.wav'),'-filter_complex','[1:a][2:a][3:a][4:a]amix=inputs=4:duration=longest:normalize=0[a]','-map','0:v','-map','[a]','-c:v','libx264','-pix_fmt','yuv420p','-r','30','-frames:v','240','-c:a','aac','-b:a','128k',str(O/'film.mp4')])
q=json.load(open(O/'timeline.json'))
for tr in q['tracks']:
 if tr['type']=='subtitles':tr['items'][1]['text']='РАСТИ, ЦВЕТОК!'
open(O/'timeline.json','w').write(json.dumps(q,ensure_ascii=False,indent=2))
ed={'originalSecondShotId':'sh2','split':[{'id':'sh2_split_a','from':120,'duration':60},{'id':'sh2_split_b','from':180,'duration':60}],'merge':{'to':'sh2','from':['sh2_split_a','sh2_split_b']},'aliases':['sh2_split_a','sh2_split_b'],'events':[{'type':'split','source':'sh2','ids':['sh2_split_a','sh2_split_b']},{'type':'merge','target':'sh2','inputs':['sh2_split_a','sh2_split_b']},{'type':'remove-prop','id':'watering_can'}],'removedPropId':'watering_can'}
open(O/'shot-edits.json','w').write(json.dumps(ed,ensure_ascii=False,indent=2))
post={'revision_d2.wav':sha(O/'revision_d2.wav'),'speech':sha(O/'stems/speech.wav')}
open(O/'dependency-events.json','w').write(json.dumps({'events':[{'stage':'before-regeneration','old':old,'new':None,'affectedDependencies':['d2','speech','film','animatic']},{'stage':'after-regeneration','old':old,'new':post,'affectedDependencies':['d2','speech','film','animatic'],'ready':True}]},ensure_ascii=False,indent=2))
