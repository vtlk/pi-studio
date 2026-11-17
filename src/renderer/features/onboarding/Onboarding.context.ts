import { createContext } from 'react';
import type { OnboardingTask } from '../../../shared/onboarding';
import type { OnboardingReadiness } from '../../../shared/onboardingReadiness';

export const OnboardingContext = createContext<{
  tasks: OnboardingTask[];
  visible: boolean;
  readiness?: OnboardingReadiness;
} | null>(null);
