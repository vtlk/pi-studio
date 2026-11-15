import os, io, math, json, wave, subprocess, shutil, re
from PIL import Image, ImageDraw, ImageFont
import cairosvg
BASE=os.path.dirname(__file__)
W,H,FPS,N=1080,1920,30,240
svg_char=open(os.path.join(BASE,'variants/ruby/character.svg'),encoding='utf-8').read()
svg_loc=open(os.path.join(BASE,'variants/ruby/location.svg'),encoding='utf-8').read()
speech=json.load(open(os.path.join(BASE,'speech.json')))
rms=speech['rmsPerFrame']; end_frame=math.ceil((.4+speech['durationSeconds'])*30)
motion=math.ceil((.4+speech['durationSeconds'])*30)+12
camera=motion+30
font='/System/Library/Fonts/Supplemental/Arial.ttf'

def render_svg(s,w,h):
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=s.encode(),output_width=w,output_height=h))).convert('RGBA')
loc=render_svg(svg_loc,2880,1680)
# masks for differential parallax: sky/sun vs terrace/bench
bg=loc.copy(); fg=loc.copy();
bg.putalpha(Image.new('L',loc.size,0)); fg.putalpha(Image.new('L',loc.size,0))
bgmask=Image.new('L',loc.size,0); ImageDraw.Draw(bgmask).rectangle((0,0,2880,455*2.4),fill=255); bg.putalpha(bgmask)
fgmask=Image.new('L',loc.size,0); ImageDraw.Draw(fgmask).rectangle((0,455*2.4,2880,1680),fill=255); fg.putalpha(fgmask)

def actor_svg(f):
    s=svg_char
    # facial mouth follows measured RMS envelope, with visible filled burgundy opening
    amp=min(1.0, rms[f]*13.0) if f < end_frame+12 else 0
    if f < end_frame+12:
        # Keep the upper lip curve stable; open the real filled gap by moving only
        # the lower return curve with the measured RMS envelope.
        lower=100+amp*34
        d=f'M 105 87 Q 120 100 135 87 Q 120 {lower:.2f} 105 87 Z'
        s=re.sub(r'<path data-part="mouth"[^>]*/>',f'<path data-part="mouth" d="{d}" fill="#8C1D40" stroke="#8C1D40" stroke-width="4" stroke-linecap="round"/>',s)
    else:
        s=re.sub(r'<path data-part="mouth"[^>]*/>','<path data-part="mouth" d="M 105 87 Q 120 100 135 87" fill="none" stroke="#8C1D40" stroke-width="4" stroke-linecap="round"/>',s)
    # gaze schedule
    gx=-4 if 18<=f<30 else (4 if 30<=f<44 else 0)
    s=s.replace('transform="translate(0 0)"','transform="translate(0 0)"')
    s=s.replace('data-part="leftPupil" cx="101" cy="68"',f'data-part="leftPupil" cx="{101+gx}" cy="68"')
    s=s.replace('data-part="rightPupil" cx="139" cy="68"',f'data-part="rightPupil" cx="{139+gx}" cy="68"')
    # closed eyes with original skin lids over whites/pupils
    if 48<=f<54:
        s=s.replace('M91 48 L111 48 L111 48 L91 48 Z','M91 48 L111 48 L111 78 L91 78 Z')
        s=s.replace('M129 48 L149 48 L149 48 L129 48 Z','M129 48 L149 48 L149 78 L129 78 Z')
    # wave bent right arm
    if motion <= f < motion+30:
        t=(f-motion)/29; ang=-55*math.sin(math.pi*t)
    else: ang=0
    s=s.replace('transform="rotate(0 182 135)"',f'transform="rotate({ang:.2f} 182 135)"')
    # smile/head tilt after wave
    if f>=camera:
        tilt=4*min(1,(f-camera)/20)
        s=s.replace('transform="rotate(0 120 72)"',f'transform="rotate({tilt:.2f} 120 72)"')
        s=s.replace('M 105 87 Q 120 98 135 87','M 105 87 Q 120 104 135 87')
    return s

def draw_lantern(d,cx,cy):
    # compact red prop, centered on the actual hand/bench target
    d.rounded_rectangle((int(cx-18),int(cy-42),int(cx+18),int(cy+4)),radius=7,fill='#D33644',outline='#7A1E2A',width=3)
    d.arc((int(cx-11),int(cy-61),int(cx+11),int(cy-35)),180,360,fill='#7A1E2A',width=3)
    d.rectangle((int(cx-12),int(cy-14),int(cx+12),int(cy-7)),fill='#F2A65A')

def frame(f):
    late=max(0,(f-camera)/max(1,N-1-camera)); push=1+0.06*late
    # camera offsets, distinct factors
    camx_bg=-1500 - 8*late; camx_fg=-300 - 40*late; camy=0-25*late
    im=Image.new('RGBA',(W,H),(135,207,234,255))
    # differential background and foreground, scaled/cropped from actual terrace SVG
    for layer,factor,base in ((bg,.2,camx_bg),(fg,1.0,camx_fg)):
        dx=base; dy=camy*factor
        lay=layer.resize((int(layer.width*push),int(layer.height*push)),Image.Resampling.BICUBIC)
        im.alpha_composite(lay,(int(dx),int(dy)))
    # actor held fixed until camera start, then participates in camera move
    ac=render_svg(actor_svg(f),864,1008)
    ax=250 + int((-40*late)); ay=390 + int((-25*late))
    im.alpha_composite(ac,(ax,ay))
    if motion <= f < motion+30:
        t=(f-motion)/29; ang=-55*math.sin(math.pi*t)
    else:
        ang=0
    # real lantern prop: it starts in the revised SVG hand, then moves continuously to the bench.
    # The hand location follows the actual bent-elbow path endpoint (180,177).
    d=ImageDraw.Draw(im)
    handx,handy=180,177; px,py=182,135
    cang=math.cos(math.radians(ang)); sang=math.sin(math.radians(ang))
    hx=px+(handx-px)*cang-(handy-py)*sang
    hy=py+(handx-px)*sang+(handy-py)*cang
    hand_global=(ax+hx*3.6, ay+hy*3.6)
    bench_global=(-300+220*2.4-40*late, 500*2.4-25*late-22)
    if f < motion:
        prop=hand_global
    elif f < motion+15:
        q=(f-motion)/15
        prop=(hand_global[0]*(1-q)+bench_global[0]*q, hand_global[1]*(1-q)+bench_global[1]*q)
    else:
        prop=bench_global
    draw_lantern(d,*prop)
    return im.convert('RGB')

qa_tmp=os.path.join(BASE,'.qa-tmp')
frames_dir=os.path.join(qa_tmp,'frames'); os.makedirs(frames_dir,exist_ok=True)
for f in range(N): frame(f).save(os.path.join(frames_dir,f'{f:04d}.png'),quality=92)
# silent visual
subprocess.run(['ffmpeg','-y','-framerate','30','-i',os.path.join(frames_dir,'%04d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',os.path.join(BASE,'visual.mp4')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
# burn opaque lower caption panel, exact uppercase line
capdir=os.path.join(qa_tmp,'captionframes'); os.makedirs(capdir,exist_ok=True)
ft=ImageFont.truetype(font,48)
for f in range(N):
    im=frame(f); d=ImageDraw.Draw(im); y=1650
    d.rounded_rectangle((70,y,1010,y+150),radius=24,fill=(20,30,42),outline=(255,255,255),width=3)
    text='ЭТОТ ФОНАРЬ ПОМОЖЕТ ПУТНИКАМ'
    box=d.textbbox((0,0),text,font=ft); tw=box[2]-box[0]
    d.text(((W-tw)//2,y+48),text,font=ft,fill='white',stroke_width=1,stroke_fill='black')
    im.save(os.path.join(capdir,f'{f:04d}.png'),quality=92)
subprocess.run(['ffmpeg','-y','-framerate','30','-i',os.path.join(capdir,'%04d.png'),'-i',os.path.join(BASE,'voice.wav'),'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-af','adelay=400:all=1','-t','8','-movflags','+faststart',os.path.join(BASE,'film.mp4')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
# clean own intermediates to stay small
shutil.rmtree(frames_dir); shutil.rmtree(capdir)
print(json.dumps({'speechEndFrame':end_frame,'motionStartFrame':motion,'cameraStartFrame':camera}))
