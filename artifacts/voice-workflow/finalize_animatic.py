from pathlib import Path
import subprocess
O=Path(__file__).parent
subprocess.run(['/opt/homebrew/bin/ffmpeg','-y','-i',str(O/'animatic.mp4'),'-i',str(O/'stems/speech.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','128k','-t','8','-movflags','+faststart',str(O/'animatic_with_audio.mp4')],check=True)
(O/'animatic_with_audio.mp4').replace(O/'animatic.mp4')
