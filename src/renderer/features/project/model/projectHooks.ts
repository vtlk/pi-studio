import { useContext } from 'react';
import { ProjectContext } from './Project.context';

export function useProject() {
  const value = useContext(ProjectContext);
  if (!value) throw new Error('ProjectProvider is missing');
  return value;
}
