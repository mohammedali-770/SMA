import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { LoginScreen } from '../../features/auth/LoginScreen';

/**
 * `next` is where the customer was when they were asked to sign in. It is
 * untrusted (anyone can write it into a link on the web export), so it is
 * passed through as-is and checked against the allow-list in `returnPath.ts`
 * at the moment it is used — never here.
 */
export default function LoginRoute() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  return <LoginScreen returnTo={typeof next === 'string' ? next : undefined} />;
}
