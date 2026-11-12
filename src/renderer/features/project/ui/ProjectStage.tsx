import { useProject } from '../model/Project';
import { ScenesView } from './ScenesView';
import { ScriptStage } from './stages/ScriptStage';
import { PlanStage } from './stages/PlanStage';
import { CastStage } from './stages/CastStage';
import { VoiceStage } from './stages/VoiceStage';
import { AssemblyStage } from './stages/AssemblyStage';
import { SoundStage } from './stages/SoundStage';
import { ExportStage } from './stages/ExportStage';
const stageComponents = [
  ScriptStage,
  PlanStage,
  CastStage,
  VoiceStage,
  ScenesView,
  AssemblyStage,
  SoundStage,
  ExportStage,
];
export function ProjectStage() {
  const { step } = useProject();
  const Stage = stageComponents[step] ?? ScriptStage;
  return <Stage />;
}
