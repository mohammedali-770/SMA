/** First-run setup route. Reached once, after the first successful sign-in. */
import React from 'react';

import { OnboardingScreen } from '../features/onboarding/OnboardingScreen';

export default function Onboarding() {
  return <OnboardingScreen />;
}
