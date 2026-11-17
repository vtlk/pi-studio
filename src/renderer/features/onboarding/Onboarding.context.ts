import { createContext } from 'react';
import type { OnboardingTask } from '../../../shared/onboarding';

export const OnboardingContext = createContext<{
  tasks: OnboardingTask[];
  visible: boolean;
} | null>(null);
