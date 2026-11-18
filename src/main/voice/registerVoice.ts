import { app, protocol, systemPreferences, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { desktopChannels } from '../../shared/contracts';
import { handleDesktopInvoke } from '../ipc/desktopInvoke';
import { VoiceModels } from './VoiceModels';
import model from './model.json';
export function registerVoice(caller: (event: IpcMainInvokeEvent) => unknown) {
  const models = new VoiceModels(
    join(app.getPath('userData'), 'runtime/voice/whisper-turbo', model.revision),
  );
  protocol.handle('studio-voice', (request) => models.response(request));
  handleDesktopInvoke(desktopChannels.prepareVoiceModel, (event) => {
    caller(event);
    return models.prepare();
  });
  handleDesktopInvoke(desktopChannels.getVoiceModelState, (event) => {
    caller(event);
    return models.read();
  });
  handleDesktopInvoke(desktopChannels.cancelVoiceModel, (event) => {
    caller(event);
    return models.close();
  });
  handleDesktopInvoke(desktopChannels.requestVoiceMicrophone, (event) => {
    caller(event);
    return process.platform === 'darwin' ? systemPreferences.askForMediaAccess('microphone') : true;
  });
  return models;
}
