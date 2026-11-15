import os, io, math, wave, subprocess
from PIL import Image, ImageDraw, ImageFont
import cairosvg
W,H,FPS,N=1080,1920,30,240
base='assets'
def svg(name):
    return Image.open(io.BytesIO(cairosvg.svg2png(url=f'{base}/{name}',output_width=W,output_height=H))).convert('RGBA')
bg=svg('background.svg'); mila=svg('character_mila.svg'); flower=svg('flower_set.svg')
font='/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
try: font=ImageFont.truetype(font,54)
except: font=ImageFont.load_default()
def frame(i):
    im=bg.copy(); d=ImageDraw.Draw(im,'RGBA')
    # soft animated sun dust
    for k in range(9):
        x=110+((k*137+i*2)%820); y=260+((k*211+i*3)%1050)
        d.ellipse((x,y,x+10,y+10),fill=(255,220,130,90))
    if i<120:
        # character enters and leans
        dx=int(-260+min(i,35)*7.5); tilt=0
        m=mila.rotate(-5 if 25<i<95 else 0,resample=Image.Resampling.BICUBIC,center=(390,1000))
        im.alpha_composite(m,(dx,0))
        # flower wilted early, then faint recovery
        f=flower.copy(); f.putalpha(f.getchannel('A').point(lambda a:a if i>100 else int(a*.95)))
        im.alpha_composite(f,(0,0))
        # watering can and drops
        d=ImageDraw.Draw(im,'RGBA'); canx=675; cany=910
        d.ellipse((canx,cany,canx+170,cany+110),fill=(105,195,200,255),outline=(87,53,43,255),width=12)
        d.line((canx+145,cany+35,canx+245,cany-15),fill=(87,53,43,255),width=18)
        if i>=72:
            for j in range(7):
                t=(i-72+j*4)/30; x=820-270*t; y=980+360*t+35*math.sin(t*math.pi)
                d.ellipse((x,y,x+18,y+28),fill=(120,205,240,220))
    else:
        im.alpha_composite(mila,(0,0)); im.alpha_composite(flower,(0,0))
        # cover/animate bloom with sparkle and happy expression emphasis
        d=ImageDraw.Draw(im,'RGBA'); p=(530,900)
        # Golden five-point star appears only in shot 2, upper-right.
        cx,cy,ro,ri=960,160,55,23
        pts=[]
        for q in range(10):
            a=-math.pi/2+q*math.pi/5; r=ro if q%2==0 else ri
            pts.append((cx+math.cos(a)*r,cy+math.sin(a)*r))
        d.polygon(pts,fill=(255,205,55,255),outline=(150,100,20,255))
        d.line(pts+[pts[0]],fill=(150,100,20,255),width=5,joint='curve')
        grow=min(1,(i-120)/55)
        for ang in range(0,360,45):
            r=150+30*math.sin((i-120)/8); x=p[0]+math.cos(math.radians(ang))*r; y=p[1]+math.sin(math.radians(ang))*r
            d.ellipse((x-10,y-10,x+10,y+10),fill=(255,220,120,180))
        if i>=195:
            d.arc((330,600,450,690),20,160,fill=(87,53,43,255),width=16)
    # subtitles
    if 16<=i<83: text='ЦВЕТОК УСТАЛ. Я ПОМОГУ.'
    elif 134<=i<195: text='ДОБРОТА РАСПУСКАЕТ ЧУДЕСА.'
    else: text=''
    if text:
        box=(70,1680,1010,1810); d.rounded_rectangle(box,28,fill=(50,90,70,205))
        bb=d.textbbox((0,0),text,font=font); d.text(((W-(bb[2]-bb[0]))//2,1715),text,font=font,fill='white')
    return im.convert('RGB')
# audio narration
narr='narration.aiff'; subprocess.run(['/usr/bin/say','-v','Milena','-o',narr,'Цветок устал. Я помогу. Доброта распускает чудеса.'],check=True)
# exact 8s quiet synth + narration using ffmpeg later
p=subprocess.Popen(['/opt/homebrew/bin/ffmpeg','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','veryfast','-crf','28','-pix_fmt','yuv420p','video_noaudio.mp4'],stdin=subprocess.PIPE)
for i in range(N): p.stdin.write(frame(i).tobytes())
p.stdin.close(); p.wait()
# synth tone bed and mix narration, pad/crop exactly 8 seconds
subprocess.run(['/opt/homebrew/bin/ffmpeg','-y','-i','narration.aiff','-f','lavfi','-i','sine=frequency=261.63:duration=8','-filter_complex','[0:a]adelay=550|550,apad,atrim=0:8,volume=0.55[n];[1:a]volume=0.055[t];[n][t]amix=inputs=2:duration=longest,atrim=0:8[a]','-map','[a]','-ar','44100','-ac','2','audio.wav'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
subprocess.run(['/opt/homebrew/bin/ffmpeg','-y','-i','video_noaudio.mp4','-i','audio.wav','-c:v','copy','-c:a','aac','-b:a','96k','-shortest','-t','8','-movflags','+faststart','film.mp4'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
